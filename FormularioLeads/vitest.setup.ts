import {cleanup} from "@testing-library/react";
import {afterEach} from "vitest";

import "@testing-library/jest-dom/vitest";

// RTL no limpia el DOM solo entre tests fuera del preset de Jest: sin esto,
// cada `render()` se acumula sobre el anterior y los `getByRole` empiezan a
// encontrar más de un elemento.
afterEach(() => {
  cleanup();
});
