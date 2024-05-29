import * as YAML from "json-to-pretty-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import { modelMappings } from "@cloudflare/ai";
import "dotenv/config";

// pwd in the root of your cloudflare-docs
const DOCS_ROOT_PATH = process.env.DOCS_ROOT_PATH;

const modelContentPath = path.join(
  DOCS_ROOT_PATH,
  "content",
  "workers-ai",
  "models"
);

async function fetchModels() {
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

// TODO: This needs to come from config API!
function getSchemaDefinitions() {
  const tasks = Object.keys(modelMappings);
  const schemaDefinitions = {};
  for (const task of tasks) {
    try {
      const AiClass = modelMappings[task].class;
      const cls = new AiClass();
      schemaDefinitions[task] = {
        input: JSON.stringify(cls.schema.input, null, "  "),
        output: JSON.stringify(cls.schema.output, null, "  "),
      };
    } catch (err) {
      console.error(err);
    }
  }
  return schemaDefinitions;
}

function getProperty(modelInfo, name, defaultValue) {
  const property = modelInfo.properties.find(prop => prop.property_id === name);
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
  const schemaDefinitions = getSchemaDefinitions();
  // FileName => frontMatter
  const frontMatters = models.reduce((registry, model) => {
    const taskType = taskTypeFromName(model.task.name);
    const params = {
      model: model,
      task_type: taskType,
      model_display_name: model.name.split("/").at(-1),
      layout: "model",
      weight: isBeta(model) ? 0 : 100,
    };
    params["title"] = params.model_display_name;
    params["json_schema"] = schemaDefinitions[taskType] || "";
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
