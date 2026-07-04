import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The standard is a browser window-event handshake — tests need a DOM with window/CustomEvent.
    environment: 'happy-dom',
  },
});
