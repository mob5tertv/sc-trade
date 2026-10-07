import type { StarSystem, Terminal } from '../../core/types';

// Where a terminal is. The name of a terminal does not say it: there are many "Stanton Gateway" in different star systems. The
// short line goes beside a name in a list, the whole place into a tooltip. Pure: what UEX knows of the terminal, nothing else.

const SEPARATOR = ' · ';

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/** The name of the star system: the one the terminal carries or, failing that, the one the list of the reference gives by its id; `''` when unknown. */
export function terminalSystem(t: Terminal, systems: readonly StarSystem[]): string {
  return clean(t.starSystemName) || clean(systems.find((s) => s.id === t.starSystemId)?.name);
}

/**
 * The parts of a place that are worth saying: not empty, not the star system itself ("Pyro · Pyro"), and not what a name of
 * the terminal says already (the station a terminal is named after, the city in its name). A part is repeated when the
 * name contains it; a name that is only a piece of the part (an "Admin - ARC-L1" in the "ARC-L1 Wide Forest Station")
 * leaves the part worth saying.
 */
function worthSaying(t: Terminal, system: string, parts: Array<string | null | undefined>): string[] {
  const names = [t.displayname, t.nickname, t.name].map((n) => clean(n).toLowerCase()).filter((n) => n !== '');
  return parts.map(clean).filter((part) => {
    const lower = part.toLowerCase();
    return part !== '' && lower !== system.toLowerCase() && !names.some((name) => name.includes(lower));
  });
}

/**
 * The short place: the star system, always (when known), and after it the most precise thing that is known and not in the
 * name: the moon, else the planet, and when there is neither, the city, else the station, else the outpost. "Stanton · Yela",
 * "Pyro". Empty when nothing is known.
 */
export function terminalPlace(t: Terminal, systems: readonly StarSystem[] = []): string {
  const system = terminalSystem(t, systems);
  const near = worthSaying(t, system, [t.moonName, t.planetName])[0] ?? worthSaying(t, system, [t.cityName, t.spaceStationName, t.outpostName])[0];
  return [system, near].filter((part) => part !== undefined && part !== '').join(SEPARATOR);
}

/**
 * The whole place for a tooltip: the star system, the planet, the moon, then the city, the station and the outpost, each
 * one only when it adds something. "Stanton · Crusader · Yela". Empty when nothing is known.
 */
export function terminalFullPlace(t: Terminal, systems: readonly StarSystem[] = []): string {
  const system = terminalSystem(t, systems);
  const parts = [system, ...worthSaying(t, system, [t.planetName, t.moonName, t.cityName, t.spaceStationName, t.outpostName])];
  // the same place named twice (a moon that is also the planet's name) is said once
  const seen = new Set<string>();
  return parts.filter((part) => part !== '' && !seen.has(part.toLowerCase()) && seen.add(part.toLowerCase())).join(SEPARATOR);
}
