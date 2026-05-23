import * as fs from "fs";

import { Model } from "./Model";
import { Licenses } from "./Licenses";
import { Models } from "./Models";
import { Issues } from "./Issues";
import { Listings } from "./Listings";
import { Listing } from "./Listing";

/**
 * The main class for the model metadata processing
 */
export class ModelMetadata {
  /**
   * The URL for the glTF-Sample-Viewer release
   */
  static readonly UrlSampleViewer =
    "https://github.khronos.org/glTF-Sample-Viewer-Release/";

  /**
   * The URL of the "raw" glTF-Sample-Assets repo
   */
  static readonly UrlModelRepoRaw =
    "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main";

  /**
   * The directory relative to root containing all models
   */
  private static readonly ModelDirectory = "./Models";

  /**
   * Whether verbose information about intermediate steps should be printed
   */
  static verbose = false;

  /**
   * Whether to omit actually writing any file
   */
  static dryRun = false;

  /**
   * Process the specified models with the given options.
   *
   * @param options - The options
   * @param inputModelNames - The input model (subdirectory) names
   * @returns An error code, 0 if there is no error
   */
  static process(
    options: Record<string, boolean>,
    inputModelNames: string[]
  ): number {
    ModelMetadata.verbose = options["verbose"] === true;
    ModelMetadata.dryRun = options["dry-run"] === true;
    const check = options["check"] === true;
    const update = options["update"] === true;

    const baseDirectory = ModelMetadata.ModelDirectory;

    // Get list of all model directory names to process
    let modelNames = inputModelNames;
    if (modelNames.length === 0) {
      modelNames = ModelMetadata.collectSubdirectoryNames(baseDirectory);
    }

    // Create all models
    const modelIssues: Record<string, Issues> = {};
    const models = Models.createModels(baseDirectory, modelNames, modelIssues);

    // If there are any errors (or if 'check' was requested),
    // print all issues.
    let anyHasErrors = false;
    for (const i of Object.values(modelIssues)) {
      anyHasErrors = anyHasErrors || i.errors.length > 0;
    }
    if (anyHasErrors || check) {
      for (const [m, i] of Object.entries(modelIssues)) {
        ModelMetadata.printIssues(m, i);
      }
    }
    if (anyHasErrors) {
      return 1;
    }

    //ModelMetadata.DEBUG_preprocessModels(models);

    // Creating the listing and overview files can only be done
    // when all models are processed
    if (inputModelNames.length !== 0) {
      return 0;
    }

    ModelMetadata.createListings(baseDirectory, models);
    if (false) {
      ModelMetadata.createExtensionListings(baseDirectory, models);
    }
    ModelMetadata.createModelIndex(baseDirectory, models);
    ModelMetadata.createReuseLicense(baseDirectory, models);

    if (update) {
      ModelMetadata.updateAllModelsFiles(baseDirectory, models);
    }
    return 0;
  }

  // Internal, preliminary tests
  //@ts-ignore
  private static DEBUG_preprocessModels(models: Model[]) {
    const knownTags = [
      "showcase",
      "video",
      "extension",
      "core",
      "testing",
      "written",
      "issues",
      "pbrtest",
    ];

    const allExtensions = new Set<string>();
    const allTags = new Set<String>();
    const allVariants = new Set<String>();
    for (const model of models) {
      const extensionsUsed = model.getExtensionsUsed();
      for (const e of extensionsUsed) {
        allExtensions.add(e);
      }

      const tags = model.getTags();
      for (const t of tags) {
        allTags.add(t);
      }

      const variants = model.getVariants();
      for (const v of Object.keys(variants)) {
        allVariants.add(v);
      }

      if (tags.includes("core") && extensionsUsed.length > 0) {
        console.log(
          `Model ${model.getName()} is tagged as 'core' but uses ${extensionsUsed}`
        );
      }
      for (const tag of tags) {
        if (!knownTags.includes(tag)) {
          console.log(`Model ${model.getName()} uses unknown tag '${tag}'`);
        }
      }
    }
    console.log("All extensions:");
    for (const e of allExtensions) {
      console.log(e);
    }
    console.log("All tags:");
    for (const t of allTags) {
      console.log(t);
    }
    console.log("All variants:");
    for (const v of allVariants) {
      console.log(v);
    }
  }

  /**
   * Create the so-called "Listings" for the given models.
   *
   * These are the markdown files that list all models that have
   * a certain tag, e.g. "Models-showcase.md".
   *
   * These listings are defined in the "Listings" class.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   */
  private static createListings(baseDirectory: string, models: Model[]) {
    const listings = Listings.LISTINGS;
    for (const listing of listings) {
      const listingReadme = ModelMetadata.createListingMarkdown(
        baseDirectory,
        listing,
        models
      );
      const listingFileName = `${baseDirectory}/${listing.file}`;

      if (ModelMetadata.dryRun) {
        ModelMetadata.logVerbose(
          `Skip writing ${listingFileName} due to dry-run`
        );
      } else {
        ModelMetadata.logVerbose(`Writing ${listingFileName}`);
        fs.writeFileSync(listingFileName, listingReadme, "utf-8");
      }
    }
  }

  /**
   * Create the markdown string for one "Listing" file.
   *
   * Such a listing file is, for example, "Models-showcase.md", which
   * contains a table of all models that are tagged with "showcase".
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param listing - The Listing object
   * @param models - The models
   * @returns The markdown
   */
  private static createListingMarkdown(
    baseDirectory: string,
    listing: Listing,
    models: Model[]
  ): string {
    ModelMetadata.logVerbose(`Creating markdown for ${listing.file}...`);

    const md: string[] = [];

    // Header with tag info and links to other listings
    const header = ModelMetadata.createListingHeaderMarkdownLines(listing);
    md.push(...header);

    // Find all tagged models and put them into the table
    const tags = listing.tags;
    const includedModels = models.filter((model) => {
      const modelTags = model.getTags();
      const isListed = ModelMetadata.includesAll(modelTags, tags);
      return isListed;
    });
    const table = ModelMetadata.createTableMarkdownLines(
      baseDirectory,
      includedModels
    );
    md.push(...table);

    // Footer with copyright information
    const footer = ModelMetadata.createFooterMarkdownLines();
    md.push(...footer);

    const result = md.join("\n");
    ModelMetadata.logVerbose(
      `Creating markdown for ${listing.file} DONE, ${includedModels.length} models`
    );
    return result;
  }

  /**
   * Create lines of markdown for the header of one of the listing files,
   * containing information about the 'tags' for this listing, as well
   * as links to all other listing files.
   *
   * @param listing - The Listing
   * @returns The markdown lines
   */
  private static createListingHeaderMarkdownLines(listing: Listing) {
    const md = [];

    // Header
    md.push("# glTF 2.0 Sample Assets");
    md.push("");
    const tags = listing.tags;
    if (tags.length === 0) {
      md.push("## All models");
    } else {
      md.push(`## Models tagged with '**${tags.join(", ")}**'`);
    }
    md.push("");
    md.push(listing.summary);
    md.push("");

    // List of links to all other 'Listings':
    md.push("## Other Tagged Listings");
    md.push("");
    const listings = Listings.LISTINGS;
    for (const otherListing of listings) {
      let tagItem = "";
      if (otherListing.tags.length > 0) {
        tagItem = "#" + otherListing.tags.join(", #");
      } else {
        tagItem = "#all";
      }
      const line = `* [${tagItem}](${otherListing.file}) - ${otherListing.summary}`;
      md.push(line);
    }
    md.push("");
    return md;
  }

  /**
   * Create lines of markdown representing a table containing the given models.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   * @returns The markdown lines
   */
  private static createTableMarkdownLines(
    baseDirectory: string,
    models: Model[]
  ): string[] {
    const md = [];
    md.push("| Model   | Description |");
    md.push("|---------|-------------|");

    for (const model of models) {
      // Create one row for the table:

      const row = [];
      row.push("| ");

      // Model name, linking to README
      row.push(`[${model.getName()}](${model.getModelUrl()}/README.md)`);
      row.push("<br>");

      // Model screenshot, linking to README
      row.push(
        `[![${model.getName()}](${model.getScreenshotUrl()})](${model.getModelUrl()}/README.md)`
      );
      row.push("<br>");

      // The "Show" link for the sample viewer
      const pathModel = model.hasGlb ? model.getGlbUrl() : model.getGltfUrl();
      row.push(
        `[Show](${ModelMetadata.UrlSampleViewer}?model=${ModelMetadata.UrlModelRepoRaw}/${baseDirectory}/${pathModel}) `
      );

      // The "Download GLB" link
      if (model.hasGlb) {
        row.push(
          `-- [Download GLB](${
            ModelMetadata.UrlModelRepoRaw
          }/${baseDirectory}/${model.getGlbUrl()}) `
        );
      }

      // Right side:
      // Summary
      row.push(`| `);
      const summary = model.getSummary();
      row.push(`${summary}<br>`);

      // Credits
      row.push(`Credit:<br>`);
      const credits = model.createCreditsMarkdownLines();
      row.push(`${credits.join("<br>")}`);
      row.push(` |`);

      md.push(row.join(""));
    }
    return md;
  }

  /**
   * Creates lines of markdown representing the footer for the model
   * listings, including copyright information and the auto-generation
   * hint.
   *
   * @returns The lines
   */
  private static createFooterMarkdownLines() {
    const md = [];
    md.push("---");
    md.push("");
    md.push(
      `### Copyright\n\n&copy; ${new Date().getFullYear()}, The Khronos Group.`
    );
    md.push("");

    const license = Licenses.LICENSE["CC-BY-4.0"];
    md.push(`**License:** [${license.text}](${license.link})`);
    md.push("");
    md.push(
      `<!-- This file is auto-generated by modelmetadata. Do not edit by hand. -->`
    );
    md.push("");
    return md;
  }

  /**
   * Create listings for all extensions that are used in the given models.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   */
  private static createExtensionListings(
    baseDirectory: string,
    models: Model[]
  ) {
    const allExtensionNames = ModelMetadata.findAllExtensionsUsed(models);

    for (const extensionName of allExtensionNames) {
      const listingReadme = ModelMetadata.createExtensionListingMarkdown(
        baseDirectory,
        extensionName,
        allExtensionNames,
        models
      );
      const listingFileName = `${baseDirectory}/Models-${extensionName}.md`;
      if (ModelMetadata.dryRun) {
        ModelMetadata.logVerbose(
          `Skip writing ${listingFileName} due to dry-run`
        );
      } else {
        ModelMetadata.logVerbose(`Writing ${listingFileName}`);
        fs.writeFileSync(listingFileName, listingReadme, "utf-8");
      }
    }
  }

  /**
   * Create the markdown string for one "Listing" file.
   *
   * Such a listing file is, for example, "Models-showcase.md", which
   * contains a table of all models that are tagged with "showcase".
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param extensionName - The extension name
   * @param allExtensionNames - All extension names
   * @param models - The models
   * @returns The markdown
   */
  private static createExtensionListingMarkdown(
    baseDirectory: string,
    extensionName: string,
    allExtensionNames: string[],
    models: Model[]
  ): string {
    ModelMetadata.logVerbose(
      `Creating markdown for listing of ${extensionName} extension...`
    );

    const md: string[] = [];

    // Header with tag info and links to other listings
    const header = ModelMetadata.createExtensionListingHeaderMarkdownLines(
      extensionName,
      allExtensionNames
    );
    md.push(...header);

    // Find all included models and put them into the table
    const includedModels = models.filter((model) => {
      const extensionsUsed = model.getExtensionsUsed();
      return extensionsUsed.includes(extensionName);
    });
    const table = ModelMetadata.createTableMarkdownLines(
      baseDirectory,
      includedModels
    );
    md.push(...table);

    // Footer with copyright information
    const footer = ModelMetadata.createFooterMarkdownLines();
    md.push(...footer);

    const result = md.join("\n");
    ModelMetadata.logVerbose(
      `Creating markdown for listing of ${extensionName} extension DONE`
    );
    return result;
  }

  /**
   * Create lines of markdown for the header of one of the extension
   * listing files, containing links to all other extension listing files.
   *
   * @param extensionName - The extension name
   * @param allExtensionNames - All extension names
   * @returns The markdown lines
   */
  private static createExtensionListingHeaderMarkdownLines(
    extensionName: string,
    allExtensionNames: string[]
  ) {
    const md = [];

    // Header
    md.push("# glTF 2.0 Sample Assets");
    md.push("");
    md.push(`## Models using the '**${extensionName}**' extension`);
    md.push("");

    // List of links to all other extension listings
    md.push("## Other extension listings");
    md.push("");
    for (const otherExtensionName of allExtensionNames) {
      const line = `* [${otherExtensionName}](Models-${otherExtensionName}.md)`;
      md.push(line);
    }
    md.push("");
    return md;
  }

  /**
   * Create the 'model-index.json' file that summarizes the names, screenshots,
   * tags, and variants of all models, in a machine-processable form.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   */
  private static createModelIndex(baseDirectory: string, models: Model[]) {
    const modelIndexJson = ModelMetadata.createModelIndexJson(models);
    const indexFileName = `${baseDirectory}/model-index.json`;
    const modelIndexJsonString = JSON.stringify(modelIndexJson, null, 2);

    if (ModelMetadata.dryRun) {
      ModelMetadata.logVerbose(`Skip writing ${indexFileName} due to dry-run`);
    } else {
      ModelMetadata.logVerbose(`Writing ${indexFileName}`);
      fs.writeFileSync(indexFileName, modelIndexJsonString, "utf-8");
    }
  }

  /**
   * Create the JSON object that goes into the 'model-index.json' file that
   * summarizes the names, screenshots, tags, and variants of all models,
   * in a machine-processable form.
   *
   * @param models - The models
   * @returns The model index JSON object
   */
  private static createModelIndexJson(models: Model[]): any {
    ModelMetadata.logVerbose(
      `Creating model index for ${models.length} models...`
    );
    const modelIndex = [];

    for (const model of models) {
      const modelJson: any = {};
      modelJson.label = model.getName();
      modelJson.name = model.getModelPath();
      modelJson.screenshot = model.getScreenshotName();

      const tags = model.getTags();
      if (tags.length !== 0) {
        modelJson.tags = tags;
      }

      modelJson.variants = {};
      const variants = model.getVariants();
      for (const [folder, file] of Object.entries(variants)) {
        modelJson.variants[folder] = file;
      }
      modelIndex.push(modelJson);
    }
    ModelMetadata.logVerbose(
      `Creating model index for ${models.length} models DONE`
    );
    return modelIndex;
  }

  /**
   * Create the "./REUSE.toml" file that aggregates the license information
   * for all models.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   */
  private static createReuseLicense(baseDirectory: string, models: Model[]) {
    const reuseText = ModelMetadata.createReuseToml(baseDirectory, models);
    const reuseFileName = `./REUSE.toml`;

    if (ModelMetadata.dryRun) {
      ModelMetadata.logVerbose(`Skip writing ${reuseFileName} due to dry-run`);
    } else {
      ModelMetadata.logVerbose(`Writing ${reuseFileName}`);
      fs.writeFileSync(reuseFileName, reuseText, "utf-8");
    }
  }

  /**
   * Create the contents of the "./REUSE.toml" file that aggregates
   * the license information for all models.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   * @returns The contents of the file
   */
  private static createReuseToml(
    baseDirectory: string,
    models: Model[]
  ): string {
    ModelMetadata.logVerbose(
      `Creating REUSE.toml for ${models.length} models...`
    );

    const text = [];

    text.push(`version = 1`);
    text.push(``);

    text.push(`[[annotations]]`);
    text.push(`path = "**"`);
    text.push(`precedence = "aggregate"`);
    const currentYear = new Date().getFullYear();
    text.push(`SPDX-FileCopyrightText = "2017-${currentYear} Khronos Group"`);
    text.push(`SPDX-License-Identifier = "CC-BY-4.0"`);
    text.push("");

    for (const model of models) {
      const files = `${baseDirectory}/${model.getModelPath()}`;
      text.push(`[[annotations]]`);
      text.push(`path = "${files.substring(2)}/*"`);
      text.push(`precedence = "aggregate"`);

      const legals = model.getLegals();

      const copyrightsSet = new Set<string>();
      const licensesSet = new Set<string>();
      for (const legal of legals) {
        const year = legal.year;
        const owner = legal.owner;
        copyrightsSet.add(`${year} ${owner}`);
        licensesSet.add(legal.license);
      }
      const copyrights = [...copyrightsSet];
      if (copyrights.length === 1) {
        text.push(`SPDX-FileCopyrightText = "${copyrights[0]}"`);
      } else {
        const copyrightsString = copyrights.map((e) => `"${e}"`).join(", ");
        text.push(`SPDX-FileCopyrightText = [ ${copyrightsString} ]`);
      }
      const licenses = [...licensesSet];
      const licensesString = licenses.join(" AND ");
      text.push(`SPDX-License-Identifier = "${licensesString}"`);
      text.push("");
    }

    const result = text.join("\n");
    ModelMetadata.logVerbose(
      `Creating REUSE.toml for ${models.length} models DONE`
    );
    return result;
  }

  /**
   * Update all auto-generated files for all models.
   *
   * See updateModelFiles for details.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param models - The models
   */
  private static updateAllModelsFiles(baseDirectory: string, models: Model[]) {
    for (const model of models) {
      ModelMetadata.updateModelFiles(baseDirectory, model);
    }
  }

  /**
   * Update all auto-generated files for the given model.
   *
   * This will write the latest state of the 'metadata.json',
   * the 'README.md', and the 'LICENSE.md' for the given model.
   *
   * @param baseDirectory - The base directory ("./Models")
   * @param model - The model
   */
  private static updateModelFiles(baseDirectory: string, model: Model) {
    ModelMetadata.logVerbose(`Update model files for ${model.getName()}...`);

    const dir = `${baseDirectory}/${model.getModelPath()}`;

    const metadata = model.getMetadata();
    const metadataString = JSON.stringify(metadata, null, 2);
    const metadataFileName = `${dir}/metadata.json`;
    if (ModelMetadata.dryRun) {
      ModelMetadata.logVerbose(
        `  Skip writing ${metadataFileName} due to dry-run`
      );
    } else {
      ModelMetadata.logVerbose(`  Writing ${metadataFileName}`);
      fs.writeFileSync(metadataFileName, metadataString, "utf8");
    }

    const readmeMd = model.createReadmeMarkdown(baseDirectory);
    if (readmeMd !== undefined) {
      const readmeFileName = `${dir}/README.md`;
      if (ModelMetadata.dryRun) {
        ModelMetadata.logVerbose(
          `  Skip writing ${readmeFileName} due to dry-run`
        );
      } else {
        ModelMetadata.logVerbose(`  Writing ${readmeFileName}`);
        fs.writeFileSync(readmeFileName, readmeMd, "utf8");
      }
    }

    const licenseMd = model.createLicenseMarkdown();
    const licenseFileName = `${dir}/LICENSE.md`;
    if (ModelMetadata.dryRun) {
      ModelMetadata.logVerbose(
        `  Skip writing ${licenseFileName} due to dry-run`
      );
    } else {
      ModelMetadata.logVerbose(`  Writing ${licenseFileName}`);
      fs.writeFileSync(licenseFileName, licenseMd, "utf8");
    }

    ModelMetadata.logVerbose(`Update model files for ${model.getName()} DONE`);
  }

  /**
   * Log the given data if verbose output was enabled
   *
   * @param data - The data
   */
  private static logVerbose(...data: any[]) {
    if (ModelMetadata.verbose) {
      console.log(...data);
    }
  }

  /**
   * Print the given issues
   *
   * @param modelName - The name of the model
   * @param issues - The issues
   */
  private static printIssues(modelName: string, issues: Issues) {
    const errors = issues.errors;
    const warnings = issues.warnings;
    if (errors.length > 0 || warnings.length > 0) {
      console.log(
        `Model '${modelName}' caused  ${errors.length} errors and ${warnings.length} warnings:`
      );
      for (let i = 0; i < errors.length; i++) {
        console.log(` E-${i + 1}: ${errors[i]}`);
      }
      for (let i = 0; i < warnings.length; i++) {
        console.log(` W-${i + 1}: ${warnings[i]}`);
      }
    }
  }

  /**
   * Returns the set of all extension names that are used in the given models
   *
   * @param models - The models
   * @returns The extension names
   */
  private static findAllExtensionsUsed(models: Model[]) {
    const allExtensionsSet = new Set<string>();
    for (const model of models) {
      const extensionsUsed = model.getExtensionsUsed();
      for (const e of extensionsUsed) {
        allExtensionsSet.add(e);
      }
    }
    const allExtensions = [...allExtensionsSet];
    allExtensions.sort();
    return allExtensions;
  }

  //--------------------------------------------------------------------------
  // Some basic helper functions

  /**
   * Collect the names of all subdirectories in the given folder.
   *
   * @param directory - The directory name
   * @returns The subdirectory names
   */
  private static collectSubdirectoryNames(directory: string = ""): string[] {
    if (directory === "") {
      console.log(`Invalid directory name: '${directory}'`);
      return [];
    }
    if (!fs.existsSync(directory)) {
      console.log(`Directory does not exist: '${directory}'`);
      return [];
    }
    const subdirectoryNames: string[] = [];
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const modelPath = `${directory}/${file}`;
      if (fs.lstatSync(modelPath).isDirectory()) {
        subdirectoryNames.push(file);
      }
    }
    subdirectoryNames.sort();
    return subdirectoryNames;
  }

  /**
   * Pragmatically read the JSON from the specified file. If the
   * file does not exist, a message is printed and 'undefined' is
   * returned.
   *
   * @param fileName - The file name
   * @returns The parsed result
   */
  static readJson(fileName: string): any {
    if (fs.existsSync(fileName)) {
      const jsonString = fs.readFileSync(fileName, "utf8").toString();
      return JSON.parse(jsonString);
    }
    console.log(`File ${fileName} does not exist`);
    return undefined;
  }

  /**
   * Returns whether the given including array contains all elements
   * from the included array.
   *
   * @param including - The including array
   * @param included - The included elements
   * @returns Whether all are included
   */
  private static includesAll<T>(including: T[], included: T[]) {
    for (const i of included) {
      if (!including.includes(i)) {
        return false;
      }
    }
    return true;
  }
}
