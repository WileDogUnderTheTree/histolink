import { loadTsData } from "../scripts/lib/load-ts-data.mjs";

const { eventPool, PERSON_NAME_ALIASES } = loadTsData();
const eventsByName = new Map();
for (const event of eventPool) {
  for (const name of event.participants ?? []) {
    if (!eventsByName.has(name)) eventsByName.set(name, []);
    eventsByName.get(name).push(event.id);
  }
}
const collisions = Object.keys(PERSON_NAME_ALIASES).filter((alias) => eventsByName.has(alias));
for (const alias of collisions) {
  console.log(alias, "→", PERSON_NAME_ALIASES[alias]);
  console.log("  alias events:", JSON.stringify(eventsByName.get(alias)));
  console.log("  target events:", JSON.stringify(eventsByName.get(PERSON_NAME_ALIASES[alias])));
  const shared = (eventsByName.get(alias) ?? []).filter((id) =>
    (eventsByName.get(PERSON_NAME_ALIASES[alias]) ?? []).includes(id),
  );
  console.log("  shared:", JSON.stringify(shared));
}
