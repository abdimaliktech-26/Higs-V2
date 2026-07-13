import "@testing-library/jest-dom"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

// Unmounts every component rendered by a test after that test finishes —
// without this, DOM from earlier .tsx tests in the same file accumulates,
// and strict absence assertions (e.g. expecting a query to find zero
// matches) can pick up unrelated leftover elements from a previous test.
afterEach(() => {
  cleanup()
})
