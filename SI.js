let modelJSON = null;
let functions = {};
let placeholderCache = {};

// Load and cache the model from a JSON file (default './model.json')
export async function loadModel(filename = './model.json') {
  if (modelJSON && modelJSON._filename === filename) {
    // Already loaded this model, just return it
    return modelJSON;
  }

  const resp = await fetch(filename);
  modelJSON = await resp.json();
  modelJSON._filename = filename; // track which file is loaded

  // Parse function strings to real JS functions
  functions = {};
  if (modelJSON.functions) {
    for (const fnName in modelJSON.functions) {
      functions[fnName] = new Function('return ' + modelJSON.functions[fnName])();
    }
  }
  return modelJSON;
}

// Replace {{placeholders}} in text by calling corresponding cached functions
function replacePlaceholders(text) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (functions[key]) {
      // Only cache "stable" functions like name, timeOfDay etc.
      if (["name", "timeOfDay", "currentTime", "currentDate"].includes(key)) {
        if (!(key in placeholderCache)) {
          placeholderCache[key] = functions[key]();
        }
        return placeholderCache[key];
      } else {
        // For dynamic functions like randomEmoji, always call fresh
        return functions[key]();
      }
    }
    return ``; // fallback if unknown function
  });
}


// Check if input contains any keyword or phrase from keywords array
function containsAny(input, keywords) {
  const inputClean = input.toLowerCase().replace(/[.,!?;:'"(){}\[\]-]/g, ' ');
  return keywords.some(keyword => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedKeyword.includes(' ')) {
      // Phrase check
      return inputClean.includes(escapedKeyword.toLowerCase());
    } else {
      // Single word check with word boundaries
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      return regex.test(inputClean);
    }
  });
}

// Get response from the loaded model using the input text
// Throws error if model not loaded yet!
export async function get_si_response(input) {
  if (!modelJSON) throw new Error("Model not loaded! Call loadModel() first.");

  placeholderCache = {}; // reset cache per call
  let matchedResponses = [];

  // 1) Find all matching response templates
  for (const keywordSet in modelJSON.response_map) {
    const keywords = modelJSON[keywordSet];
    console.log("Checking keywordSet:", keywordSet, "=>", keywords);
    if (!keywords) continue;
    if (containsAny(input, keywords)) {
      const responseKey = modelJSON.response_map[keywordSet];
      const responses = modelJSON[responseKey];
      if (responses && responses.length > 0) {
        matchedResponses.push(
          responses[Math.floor(Math.random() * responses.length)]
        );
      }
    }
  }

  // 2) Fallback if no matches
  if (matchedResponses.length === 0) {
    const unsure = modelJSON.unsure_responses || ["Sorry, I didn't get that."];
    return unsure[Math.floor(Math.random() * unsure.length)];
  }

  // 3) Process each template: replace placeholders + eval template literals
  const processed = matchedResponses.map(rawResp => {
    // a) Replace {{placeholders}}
    const withPlaceholders = replacePlaceholders(rawResp);

    // b) Evaluate any JS in it via template literal eval
    try {
      // Escape backticks before wrapping
      const safeStr = withPlaceholders.replace(/`/g, '\\`');
      return new Function('return `' + safeStr + '`')();
    } catch (err) {
      console.warn('Template eval failed:', err);
      // Fall back to placeholder-only string
      return withPlaceholders;
    }
  });

  // 4) Join and return
  return processed.join("\n");
}
