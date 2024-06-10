import * as YAML from "json-to-pretty-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";

// pwd in the root of your cloudflare-docs
const DOCS_ROOT_PATH = process.env.DOCS_ROOT_PATH;

const modelContentPath = path.join(
  DOCS_ROOT_PATH,
  "content",
  "workers-ai",
  "models"
);

const KNOWN_ALIASES_THAT_SHOULD_NOT_BE_SHOWN_AS_MODEL_PAGES = [
  '@hf/meta-llama/meta-llama-3-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.1-vllm',
];

async function fetchModels() {
  // NOTE: This is not paging
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.AUTH_ACCOUNT}/ai/models/search`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  const json = await response.json();
  return json.result;
}

function taskTypeFromName(taskName) {
  // Kebab case
  return taskName.toLowerCase().split(" ").join("-");
}

async function getSchemaDefinitionByModelName(modelName) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${
      process.env.AUTH_ACCOUNT
    }/ai/models/schema?model=${encodeURIComponent(modelName)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  const json = await response.json();
  return json.result;
}

async function getSchemaDefinitions(models) {
  const schemaRegistry = {};
  const batchSize = 10;
  for (let i = 0; i < models.length; i += batchSize) {
    const batch = models.slice(i, i + batchSize);
    const batchPromises = batch.map((model) =>
      getSchemaDefinitionByModelName(model.name)
    );
    const batchResults = await Promise.all(batchPromises);
    for (let j = 0; j < batch.length; j++) {
      schemaRegistry[batch[j].name] = batchResults[j];
    }
  }
  return schemaRegistry;
}

function getProperty(modelInfo, name, defaultValue) {
  const property = modelInfo.properties.find(
    (prop) => prop.property_id === name
  );
  if (property === undefined) {
    return defaultValue;
  }
  return property.value;
}

function isBeta(modelInfo) {
  const beta = getProperty(modelInfo, "beta", false);
  if (beta) {
    return beta.toLowerCase() === "true";
  }
  return beta;
}

async function getModelRegistry() {
  const models = await fetchModels();
  console.log(`Found ${models.length} models`);
  const schemaDefinitions = await getSchemaDefinitions(models);
  // FileName => frontMatter
  const frontMatters = models.reduce((registry, model) => {
    if (KNOWN_ALIASES_THAT_SHOULD_NOT_BE_SHOWN_AS_MODEL_PAGES.includes(model.name)) {
      console.warn(`Found a known alias that shouldn't be rendered ${model.name}. Notify Workers AI API team.`);
      return registry;
    }
    const taskType = taskTypeFromName(model.task.name);
    const params = {
      model: model,
      task_type: taskType,
      model_display_name: model.name.split("/").at(-1),
      layout: "model",
      weight: isBeta(model) ? 0 : 100,
    };
    params["title"] = params.model_display_name;
    const json_schema = schemaDefinitions[model.name];
    params["json_schema"] = {
      input: JSON.stringify(json_schema.input, null, "  "),
      output: JSON.stringify(json_schema.output, null, "  "),
    };
    registry[`${params.model_display_name}.md`] = YAML.stringify(params);
    return registry;
  }, {});
  return frontMatters;
}

(async () => {
  const frontMatters = await getModelRegistry();
  for (const [fileName, frontMatter] of Object.entries(frontMatters)) {
    const filePath = path.join(modelContentPath, fileName);
    fs.writeFileSync(`${filePath}`, `---\n${frontMatter}\n---\n`);
    console.log(`Wrote ${filePath}`);
  }
})();
