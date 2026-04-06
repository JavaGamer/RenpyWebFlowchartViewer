// Extends Vitest's expect with @testing-library/jest-dom DOM matchers
// (e.g. toBeInTheDocument, toHaveTextContent, …).
import '@testing-library/jest-dom/vitest';

// Ensure React's act() integration is enabled in the Vitest + jsdom environment.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
