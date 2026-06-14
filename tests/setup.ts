import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';
expect.extend(matchers);


// Ensure React's act() integration is enabled in the Vitest + jsdom environment.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
