import * as YAML from "json-to-pretty-yaml";
import * as fs from "node:fs";
import * as path from "node:path";

// pwd in the root of your cloudflare-docs
const DOCS_ROOT_PATH = process.env.DOCS_ROOT_PATH;

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

(async () => {
  const models = await fetchModels();
  console.log(`Found ${models.length} models`);
  // FileName => frontMatter
  const frontMatters = models.reduce((registry, model) => {
    const params = {
      model: model,
      task_type: taskTypeFromName(model.task.name),
      model_display_name: model.name.split("/").at(-1),
      layout: "model",
    };
    params["title"] = params.model_display_name;
    registry[`${params.model_display_name}.md`] = YAML.stringify(params);
    return registry;
  }, {});
  const taskTypes = new Set<string>(
    models.map((model) => taskTypeFromName(model.task.name))
  );
  for (const [fileName, frontMatter] of Object.entries(frontMatters)) {
    const filePath = path.join("/tmp", fileName);
    fs.writeFileSync(`${filePath}`, `---\n${frontMatter}\n---\n\nTODO: JSON Schemas`)
    console.log(`Wrote ${filePath}`);
  }
})();
