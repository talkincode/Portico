import { serialize, writeJsonFile } from "../fs.ts";
import type { PageDocument } from "./types.ts";

export interface PageStore {
  load(): Promise<PageDocument | undefined>;
  save(document: PageDocument): Promise<void>;
}

function cloneDocument(document: PageDocument): PageDocument {
  return structuredClone(document);
}

export class MemoryPageStore implements PageStore {
  #document: PageDocument | undefined;

  load(): Promise<PageDocument | undefined> {
    return Promise.resolve(this.#document ? cloneDocument(this.#document) : undefined);
  }

  save(document: PageDocument): Promise<void> {
    this.#document = cloneDocument(document);
    return Promise.resolve();
  }
}

export class FilePageStore implements PageStore {
  constructor(private readonly path: string) {}

  async load(): Promise<PageDocument | undefined> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as PageDocument;
      if (!parsed || !Array.isArray(parsed.components)) {
        throw new Error(`page file is corrupt: ${this.path}`);
      }
      return cloneDocument(parsed);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  save(document: PageDocument): Promise<void> {
    return serialize(this.path, () => this.#saveImpl(document));
  }

  async #saveImpl(document: PageDocument): Promise<void> {
    await writeJsonFile(this.path, cloneDocument(document));
  }
}
