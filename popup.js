// Modified by tommyzed: Added repository selector and suggestions
/**
 * Jules Task Manager — Popup Script
 *
 * Handles UI interactions, settings persistence, and progress display.
 */

const $ = (sel) => document.querySelector(sel)

// --- DOM refs ---
const repoFilterInput = $('#repoFilter')
const customRepoInput = $('#customRepoInput')
const startBtn = $('#startBtn')
const resetBtn = $('#resetBtn')
const downloadBtn = $('#downloadBtn')
const progressSection = $('#progressSection')
const summarySection = $('#summarySection')
const currentInfo = $('#currentInfo')
const progressFill = $('#progressFill')
const logPre = $('#log')
const summaryDiv = $('#summary')

// --- Operation mode state ---
let opMode = 'archive'

function getRunningText() {
  const modeRadio = document.querySelector('input[name="mode"]:checked')
  const isDry = modeRadio && modeRadio.value === 'dry'

  if (opMode === 'archive') {
    return isDry ? '⏳ Dry Running Archive...' : '⏳ Running Archive...'
  } else if (opMode === 'remove_suggestions') {
    return isDry ? '⏳ Dry Running Remove Suggestions...' : '⏳ Running Remove Suggestions...'
  } else if (opMode === 'export_suggestions') {
    return '⏳ Exporting Suggestions to JSON...'
  } else if (opMode === 'agent_batch') {
    return isDry ? '⏳ Dry Running Batch Agent...' : '⏳ Launching Single Agent for All Suggestions...'
  } else {
    return isDry ? '⏳ Dry Running Suggestions...' : '⏳ Running Suggestions...'
  }
}

// --- Operation mode selector ---
function setActiveOpMode(value) {
  opMode = value
  updateOpModeUI(value)
}

function updateOpModeUI(value) {
  document.querySelectorAll('#opMode button').forEach((b) => {
    const isActive = b.dataset.value === value
    b.classList.toggle('active', isActive)
    b.setAttribute('aria-pressed', String(isActive))
  })

  updateStartButtonText()
}

function updateStartButtonText() {
  if (startBtn.getAttribute('aria-busy') === 'true') return
  const modeRadio = document.querySelector('input[name="mode"]:checked')
  const isDry = modeRadio && modeRadio.value === 'dry'
  if (opMode === 'archive') {
    startBtn.textContent = isDry ? 'Dry Run Archive' : 'Start Archiving'
  } else if (opMode === 'remove_suggestions') {
    startBtn.textContent = isDry ? 'Dry Run Remove Suggestions' : 'Remove Suggestions'
  } else if (opMode === 'export_suggestions') {
    startBtn.textContent = 'Export Suggestions JSON'
  } else {
    startBtn.textContent = isDry ? 'Dry Run Suggestions' : 'Start Suggestions'
  }
}

function updateStartBtnState() {
  if (startBtn.getAttribute('aria-busy') === 'true') return
  const hasSelection = Boolean(repoFilterInput.value || (customRepoInput && customRepoInput.value.trim()))
  startBtn.disabled = !hasSelection
  updateStartButtonText()
}

document.querySelectorAll('#opMode button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveOpMode(btn.dataset.value)
    chrome.storage.sync.set({ opMode })
  })
})

// Update button text when execution mode changes
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    updateStartButtonText()
  })
})

chrome.storage.sync.get(['opMode'], (syncData) => {
  if (syncData.opMode) {
    setActiveOpMode(syncData.opMode)
  }
})

function applyCodebases(codebases) {
  const currentValue = repoFilterInput.value

  // Clear options except the first one ("Choose a Repo")
  while (repoFilterInput.options.length > 1) {
    repoFilterInput.remove(1)
  }

  for (const cb of codebases) {
    const opt = document.createElement('option')
    opt.value = cb
    opt.textContent = cb
    repoFilterInput.appendChild(opt)
  }

  // Add "All Repositories" option at the bottom
  const allOpt = document.createElement('option')
  allOpt.value = '__ALL__'
  allOpt.textContent = 'All Repositories'
  repoFilterInput.appendChild(allOpt)

  if (currentValue) {
    repoFilterInput.value = currentValue
  }
  updateStartBtnState()
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

async function populateCodebases(attempt = 0) {
  // Query background for all connected sources via Jules API first
  chrome.runtime.sendMessage({ action: 'GET_ALL_SOURCES' }, (bgResp) => {
    if (bgResp?.repos && bgResp.repos.length > 0) {
      applyCodebases(bgResp.repos)
      return
    }

    // Fallback to DOM elements on current page if background fetch hasn't completed
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, { action: 'GET_CODEBASES' }, (response) => {
        if (chrome.runtime.lastError || !response?.codebases?.length) {
          if (attempt < MAX_RETRIES) {
            setTimeout(() => populateCodebases(attempt + 1), RETRY_DELAY_MS)
          }
          return
        }
        applyCodebases(response.codebases)
      })
    })
  })
}

populateCodebases()
updateStartBtnState()

// --- Update start button on repo selection change ---
repoFilterInput.addEventListener('change', () => {
  if (repoFilterInput.value && customRepoInput) customRepoInput.value = ''
  updateStartBtnState()
})

if (customRepoInput) {
  customRepoInput.addEventListener('input', () => {
    if (customRepoInput.value.trim()) {
      repoFilterInput.value = ''
    }
    updateStartBtnState()
  })
}


// --- Start operation ---
startBtn.addEventListener('click', async () => {
  const customVal = customRepoInput ? customRepoInput.value.trim() : ''
  const selected = customVal || repoFilterInput.value
  if (!selected) {
    return // Non-functional if nothing selected or typed
  }

  const mode = document.querySelector('input[name="mode"]:checked').value

  // Get active tab
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })
  const activeTabId = tab?.id

  const options = {
    dryRun: mode === 'dry',
    force: true,
    activeTabId,
    opMode,
    repoFilter: selected === '__ALL__' ? '' : selected.trim()
  }

  // Reset UI
  startBtn.disabled = true
  startBtn.setAttribute('aria-busy', 'true')
  startBtn.textContent = getRunningText()
  resetBtn.style.display = 'none'
  progressSection.style.display = 'block'
  summarySection.style.display = 'none'
  currentInfo.textContent = 'Starting...'
  progressFill.style.width = '0%'
  progressFill.style.background = '' // Reset error color if present
  logPre.textContent = ''

  chrome.runtime.sendMessage({ action: 'START', options })
})

// --- Reset (Clear Log) ---
resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'RESET' })
  startBtn.removeAttribute('aria-busy')
  resetBtn.style.display = 'none'
  progressSection.style.display = 'none'
  summarySection.style.display = 'none'
  if (downloadBtn) downloadBtn.style.display = 'none'
  repoFilterInput.value = ''
  updateStartBtnState()
  // Move focus back to the primary action so keyboard users are not stranded
  // on the now-hidden Reset button.
  startBtn.focus()
})

// --- Listen for state changes ---
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.archiveState) return
  const state = changes.archiveState.newValue
  if (!state) return
  renderState(state)
})

// --- Render state ---
function renderState(state) {
  // Log
  if (state.log?.length > 0) {
    logPre.textContent = state.log.join('\n')
    logPre.scrollTop = logPre.scrollHeight
    progressSection.style.display = 'block'
  }

  // Current info
  if (state.status === 'running') {
    const parts = []
    if (state.currentTab) parts.push(state.currentTab)
    if (state.currentRepo) parts.push(state.currentRepo)
    currentInfo.textContent = parts.join(' > ')

    if (state.progress?.total > 0) {
      const pct = Math.round(((state.progress.archived + state.progress.skipped) / state.progress.total) * 100)
      progressFill.style.width = `${pct}%`
      progressFill.parentElement.setAttribute('aria-valuenow', String(pct))
      currentInfo.textContent += ` [${state.progress.archived + state.progress.skipped}/${state.progress.total}]`
    }
  }

  // Done or error
  if (state.status === 'done' || state.status === 'error') {
    startBtn.removeAttribute('aria-busy')
    updateStartBtnState()
    resetBtn.style.display = 'block'
    progressFill.style.width = '100%'
    progressFill.parentElement.setAttribute('aria-valuenow', '100')

    if (state.status === 'done') {
      currentInfo.textContent = 'Complete'
      renderSummary(state.results)
      if (state.exportData) {
        lastExportData = state.exportData
        if (downloadBtn) {
          downloadBtn.style.display = 'block'
          downloadBtn.textContent = `⬇ Download Suggestions JSON (${state.exportData.totalSuggestions || 0} found)`
        }
      }
    } else {
      currentInfo.textContent = `Error: ${state.error}`
      progressFill.style.background = '#f87171'
    }
  }
}

// --- Render summary (safe DOM methods, no innerHTML) ---
function renderSummary(results) {
  summarySection.style.display = 'block'
  summaryDiv.textContent = ''

  if (!results?.length) {
    const emptyDiv = document.createElement('div')
    emptyDiv.className = 'hint'
    emptyDiv.style.marginTop = '4px'
    emptyDiv.textContent = 'No items were processed. Try checking if tasks exist.'
    summaryDiv.appendChild(emptyDiv)
    return
  }

  // ⚡ Bolt Optimization: Use DocumentFragment to batch DOM insertions.
  // This prevents redundant browser reflows/repaints when processing large
  // numbers of repositories, improving performance during summary rendering.
  const fragment = document.createDocumentFragment()
  let grand = 0

  for (const r of results) {
    grand += r.count
    const div = document.createElement('div')
    if (r.err) {
      div.className = 'error'
      div.textContent = `${r.label}: ERROR - ${r.err}`
    } else {
      div.textContent = `${r.label}: ${r.count} processed`
    }
    fragment.appendChild(div)
  }

  const totalDiv = document.createElement('div')
  totalDiv.className = 'total'
  totalDiv.textContent = `TOTAL: ${grand} processed`
  fragment.appendChild(totalDiv)

  summaryDiv.appendChild(fragment)
}

// --- Check for existing state on popup open ---
chrome.runtime.sendMessage({ action: 'GET_STATE' }, (state) => {
  if (state && state.status !== 'idle') {
    // Rehydrate opMode if it's available in the state options
    if (state.options?.opMode) {
      opMode = state.options.opMode
    }
    renderState(state)
    if (state.status === 'running') {
      startBtn.disabled = true
      startBtn.setAttribute('aria-busy', 'true')
      startBtn.textContent = getRunningText()
    } else {
      resetBtn.style.display = 'block'
      updateStartBtnState()
    }
  } else {
    updateStartBtnState()
  }
})

let lastExportData = null

if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    if (lastExportData) {
      downloadExportedSuggestions(lastExportData)
    }
  })
}

function downloadExportedSuggestions(exportData) {
  try {
    const filename = `jules-suggestions-${new Date().toISOString().slice(0, 10)}.json`
    const jsonStr = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 1000)
    console.log('Download initiated for', filename)
  } catch (err) {
    console.error('Failed to trigger JSON download:', err)
  }
}
