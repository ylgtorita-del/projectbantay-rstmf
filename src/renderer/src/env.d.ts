/// <reference types="vite/client" />
import type { BantayApi } from '../../preload'

declare global {
  interface Window {
    bantay: BantayApi
  }
}

export {}
