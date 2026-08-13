import fs from 'node:fs/promises';

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_TARGETS = 50;
const MAX_REFS = 20;
const MAX_ARTIFACT_NAMES = 20;
const MAX_INPUTS = 24;
const MAX_INPUT_PAYLOAD = 65_535;
const TARGET_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const WORKFLOW_FILE = /^[A-Za-z0-9_.-]{1,100}\.ya?ml$/i;
const REF = /^[A-Za-z0-9._/-]{1,200}$/;
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/;
const RESERVED_INPUT = 'pocketforge_request_id';

export async function loadActionTargets(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('POCKETFORGE_ACTIONS_TARGETS_FILE must name a JSON file.');
  }
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('The actions target configuration must be a regular file, not a symbolic link.');
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new Error(`The actions target configuration exceeds ${MAX_CONFIG_BYTES} bytes.`);
  }
  const text = await fs.readFile(filePath, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The actions target configuration must contain valid JSON.');
  }
  return parseActionTargets(value);
}

export function parseActionTargets(value) {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.targets)) {
    throw new Error('Actions targets must use schemaVersion 1 and contain a targets array.');
  }
  if (value.targets.length < 1 || value.targets.length > MAX_TARGETS) {
    throw new Error(`Actions targets must contain between 1 and ${MAX_TARGETS} entries.`);
  }
  const ids = new Set();
  const targets = value.targets.map((entry, index) => parseTarget(entry, index, ids));
  return deepFreeze({ schemaVersion: 1, targets });
}

export function publicActionTargets(catalog) {
  assertCatalog(catalog);
  return catalog.targets.map(target => ({
    id: target.id,
    name: target.name,
    repository: target.repository,
    workflow: target.workflow,
    refs: [...target.refs],
    inputs: { ...target.inputs },
    artifactNames: [...target.artifactNames],
  }));
}

export function resolveActionTarget(catalog, targetId, ref) {
  assertCatalog(catalog);
  if (typeof targetId !== 'string' || !TARGET_ID.test(targetId)) {
    throw new Error('Action target id is invalid.');
  }
  const target = catalog.targets.find(candidate => candidate.id === targetId);
  if (!target) throw new Error(`Unknown action target: ${targetId}`);
  if (typeof ref !== 'string' || !target.refs.includes(ref)) {
    throw new Error(`Ref is not allowlisted for action target ${targetId}.`);
  }
  return deepFreeze({
    id: target.id,
    name: target.name,
    repository: target.repository,
    owner: target.owner,
    repo: target.repo,
    workflow: target.workflow,
    ref,
    inputs: { ...target.inputs },
    artifactNames: [...target.artifactNames],
  });
}

function parseTarget(value, index, ids) {
  if (!isPlainObject(value)) throw new Error(`Action target ${index + 1} must be an object.`);
  const id = requiredString(value.id, `Action target ${index + 1} id`, 64);
  if (!TARGET_ID.test(id)) throw new Error(`Action target id "${id}" contains unsupported characters.`);
  if (ids.has(id)) throw new Error(`Duplicate action target id: ${id}`);
  ids.add(id);

  const name = requiredString(value.name, `Action target ${id} name`, 80);
  const repository = parseRepository(value.repository, id);
  const workflow = requiredString(value.workflow, `Action target ${id} workflow`, 104);
  if (!WORKFLOW_FILE.test(workflow) || workflow === '.' || workflow === '..') {
    throw new Error(`Action target ${id} workflow must be a .yml or .yaml file name without a path.`);
  }
  const refs = parseUniqueStrings(value.refs, {
    label: `Action target ${id} refs`,
    maxItems: MAX_REFS,
    validate: validateRef,
  });
  const inputs = parseInputs(value.inputs ?? {}, id);
  const artifactNames = parseUniqueStrings(value.artifactNames ?? [], {
    label: `Action target ${id} artifactNames`,
    maxItems: MAX_ARTIFACT_NAMES,
    allowEmpty: true,
    validate: name => {
      if (!ARTIFACT_NAME.test(name) || name === '.' || name === '..') {
        throw new Error(`Action target ${id} contains an unsafe artifact name.`);
      }
    },
  });
  return deepFreeze({
    id,
    name,
    repository: repository.url,
    owner: repository.owner,
    repo: repository.repo,
    workflow,
    refs,
    inputs,
    artifactNames,
  });
}

function parseRepository(input, targetId) {
  if (typeof input !== 'string' || input.length > 500) {
    throw new Error(`Action target ${targetId} repository must be a GitHub HTTPS URL.`);
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Action target ${targetId} repository must be a valid URL.`);
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`Action target ${targetId} repository must use https://github.com.`);
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`Action target ${targetId} repository URL cannot contain credentials, ports, queries, or fragments.`);
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2) {
    throw new Error(`Action target ${targetId} repository must have the form https://github.com/owner/repository.`);
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!REPOSITORY_PART.test(owner) || !REPOSITORY_PART.test(repo)) {
    throw new Error(`Action target ${targetId} repository owner or name contains unsupported characters.`);
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function parseInputs(value, targetId) {
  if (!isPlainObject(value)) throw new Error(`Action target ${targetId} inputs must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > MAX_INPUTS) {
    throw new Error(`Action target ${targetId} may define at most ${MAX_INPUTS} fixed inputs.`);
  }
  const inputs = {};
  for (const [key, inputValue] of entries) {
    if (!INPUT_NAME.test(key)) throw new Error(`Action target ${targetId} contains an invalid input name.`);
    if (key === RESERVED_INPUT) throw new Error(`${RESERVED_INPUT} is reserved by PocketForge Relay.`);
    if (!isInputScalar(inputValue)) {
      throw new Error(`Action target ${targetId} input ${key} must be a string, boolean, or finite number.`);
    }
    inputs[key] = inputValue;
  }
  const dispatchInputs = { ...inputs, [RESERVED_INPUT]: '00000000-0000-4000-8000-000000000000' };
  if (Buffer.byteLength(JSON.stringify(dispatchInputs), 'utf8') > MAX_INPUT_PAYLOAD) {
    throw new Error(`Action target ${targetId} inputs exceed the GitHub workflow_dispatch payload limit.`);
  }
  return deepFreeze(inputs);
}

function parseUniqueStrings(value, { label, maxItems, allowEmpty = false, validate }) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxItems) {
    const minimum = allowEmpty ? 0 : 1;
    throw new Error(`${label} must contain between ${minimum} and ${maxItems} entries.`);
  }
  const seen = new Set();
  const result = value.map(item => {
    if (typeof item !== 'string' || !item || item !== item.trim()) throw new Error(`${label} must contain non-empty trimmed strings.`);
    validate(item);
    if (seen.has(item)) throw new Error(`${label} contains a duplicate entry: ${item}`);
    seen.add(item);
    return item;
  });
  return deepFreeze(result);
}

function validateRef(ref) {
  if (!REF.test(ref) || ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/') || ref.includes('..') || ref.includes('@{') || ref.includes('//')) {
    throw new Error('Action target contains an unsafe Git ref.');
  }
}

function requiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be non-empty trimmed text no longer than ${maxLength} characters.`);
  }
  return value;
}

function assertCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.targets)) {
    throw new Error('A parsed actions target catalog is required.');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isInputScalar(value) {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
