export type Commit = { hash: string; subject: string; at: number }

export type PullRequest = { number: number; state: string; url: string }

// What one look at the project found; times are epoch milliseconds.
export type Snapshot = {
  isRepo: boolean
  // owner/name from the GitHub remote, else the folder's name.
  repo: string
  branch: string
  dirty: number
  // Commits on this branch that origin does not have; null when the branch
  // has no upstream yet.
  ahead: number | null
  behind: number
  lastCommit: Commit | null
  hasRemote: boolean
  pr: PullRequest | null
  liveUrl: string | null
  // True when Ship Track found the live URL itself rather than being told it.
  isLiveUrlGuessed: boolean
  liveStatus: number | null
  lastDeployAt: number | null
  commitsSinceDeploy: number
  checkedAt: number
}

// Kept per project folder across sessions.
export type Remembered = { liveUrl: string | null; lastDeployAt: number | null; isGuessed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'ship-track': {
      snapshot: Shaped<Snapshot | null>
      isChecking: boolean
      // The repo Claude last shipped from, when it isn't the session's own.
      folder: string | null
    }
  }
}
