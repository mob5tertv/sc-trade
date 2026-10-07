import { UexError } from '../../src/data/uex-client';
import type { FakeUex } from './fake-uex';

// `FakeUex` fails every scripted request the way a stalled network does (`UexError` of kind `network`). The sync treats the
// kinds of failure differently: a network failure is not repeated terminal by terminal and, three in a row, ends the run; a
// refusal of the server is repeated. These helpers let a test choose the kind of failure of the requests it scripts to fail.

/** What a stalled network looks like to the client. */
export const networkStall = (): UexError => new UexError('network', 'request failed: stalled');

/** What a server that answers badly looks like to the client: it did answer, so the network works. */
export const serverRefusal = (): UexError => new UexError('http', 'HTTP 503');

/** What UEX answers when too many requests came: HTTP 429. */
export const rateLimit = (): UexError => new UexError('http', 'HTTP 429: UEX request limit reached', { httpStatus: 429 });

/** Turns the failures of `uex.distancesFrom` that are scripted (`failRoutes`) into the error `make` returns. */
export function failRoutesAs(uex: FakeUex, make: () => UexError): void {
  const scripted = uex.distancesFrom.bind(uex);
  uex.distancesFrom = (terminalId) => scripted(terminalId).catch((err: unknown) => {
    throw err instanceof UexError ? make() : err;
  });
}

/** Turns the failures of `uex.distance` that are scripted (`failDistances`) into the error `make` returns. */
export function failDistancesAs(uex: FakeUex, make: () => UexError): void {
  const scripted = uex.distance.bind(uex);
  uex.distance = (a, b) => scripted(a, b).catch((err: unknown) => {
    throw err instanceof UexError ? make() : err;
  });
}

/** Turns the failures of `uex.prices` that are scripted (`failPrices`) into the error `make` returns for the terminals of the request. */
export function failPricesAs(uex: FakeUex, make: (terminalIds: number[]) => UexError): void {
  const scripted = uex.prices.bind(uex);
  uex.prices = (terminalIds) => scripted(terminalIds).catch((err: unknown) => {
    throw err instanceof UexError ? make(terminalIds) : err;
  });
}

/** Turns the failures of `uex.vehicles` that are scripted (`failVehiclesOf`) into the error `make` returns. */
export function failVehiclesAs(uex: FakeUex, make: () => UexError): void {
  const scripted = uex.vehicles.bind(uex);
  uex.vehicles = (companyId) => scripted(companyId).catch((err: unknown) => {
    throw err instanceof UexError ? make() : err;
  });
}
