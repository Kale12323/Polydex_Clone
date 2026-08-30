// modelManager.js
// Simple utility to keep separate AI/ML model instances with their context
// and switch between them without losing state.

const modelInstances = new Map(); // id => {model, context}

/**
 * Register a model with an identifier and initial context.
 * @param {string} id - Unique identifier for the model
 * @param {Object} model - The model instance (e.g., TensorFlow.js model)
 * @param {Object} [context={}] - Any contextual data to associate with the model
 */
function registerModel(id, model, context = {}) {
  if (modelInstances.has(id)) {
    console.warn(`Model with id "${id}" already registered. Overwriting.`);
  }
  modelInstances.set(id, { model, context });
}

/**
 * Retrieve a model instance and its context by id.
 * @param {string} id
 * @returns {{model: Object, context: Object}|null}
 */
function getModel(id) {
  return modelInstances.get(id) || null;
}

/**
 * Update the context for a registered model.
 * @param {string} id
 * @param {Object} newContext - Will be merged with existing context
 */
function updateModelContext(id, newContext) {
  const entry = modelInstances.get(id);
  if (!entry) {
    throw new Error(`No model registered with id "${id}"`);
  }
  entry.context = { ...entry.context, ...newContext };
}

/**
 * Switch to a different model, returning its instance and context.
 * @param {string} id
 * @returns {{model: Object, context: Object}}
 */
function switchModel(id) {
  const entry = getModel(id);
  if (!entry) {
    throw new Error(`Model "${id}" not found. Register it first.`);
  }
  return entry;
}

/**
 * Remove a model from the manager.
 * @param {string} id
 */
function unregisterModel(id) {
  modelInstances.delete(id);
}

/**
 * List all registered model IDs.
 * @returns {string[]}
 */
function listModels() {
  return Array.from(modelInstances.keys());
}

module.exports = {
  registerModel,
  getModel,
  updateModelContext,
  switchModel,
  unregisterModel,
  listModels
};