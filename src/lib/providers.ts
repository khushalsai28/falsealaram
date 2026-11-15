import type { Source } from "../types";

export interface SourceProvider {
  name: Source["provider"];
  search(keywords: string[], query: string): Promise<Source[]>;
}

function isSource(value: unknown): value is Source {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.title === "string" &&
    typeof source.authors === "string" &&
    (typeof source.year === "number" || source.year === null) &&
    typeof source.url === "string" &&
    typeof source.snippet === "string" &&
    ["google-scholar", "semantic-scholar", "openalex", "none"].includes(String(source.provider)) &&
    (source.summary === undefined || typeof source.summary === "string")
  );
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Source provider request failed (${response.status}).`);
      }
      lastError = new Error(
        response.status === 429
          ? "Source provider rate limited the request."
          : `Source provider is temporarily unavailable (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error && !/temporarily unavailable|rate limited/.test(error.message)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("Source provider request failed.");
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw lastError ?? new Error("Source provider request failed.");
}

function getAuthors(authors: unknown): string {
  if (!Array.isArray(authors)) return "";
  return authors
    .map((author) =>
      author && typeof author === "object" && "name" in author
        ? String(author.name)
        : author && typeof author === "object" && "authorId" in author
          ? ""
          : "",
    )
    .filter(Boolean)
    .join(", ");
}

const semanticScholar: SourceProvider = {
  name: "semantic-scholar",
  async search(keywords, query) {
    const search = [query, ...keywords].filter(Boolean).join(" ");
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", search);
    url.searchParams.set("fields", "title,abstract,year,authors,externalIds,url");
    url.searchParams.set("limit", "3");
    const response = await fetchWithRetry(url.toString());
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("data" in data) || !Array.isArray(data.data)) {
      throw new Error("Semantic Scholar returned an invalid response.");
    }
    return data.data.slice(0, 3).flatMap((paper): Source[] => {
      if (!paper || typeof paper !== "object") return [];
      const item = paper as Record<string, unknown>;
      if (typeof item.title !== "string" || !item.title) return [];
      const externalIds =
        item.externalIds && typeof item.externalIds === "object"
          ? (item.externalIds as Record<string, unknown>)
          : {};
      const urlValue =
        typeof item.url === "string"
          ? item.url
          : typeof externalIds.DOI === "string"
            ? `https://doi.org/${externalIds.DOI}`
            : "";
      if (!urlValue) return [];
      return [
        {
          title: item.title,
          authors: getAuthors(item.authors),
          year: typeof item.year === "number" ? item.year : null,
          url: urlValue,
          snippet: typeof item.abstract === "string" ? item.abstract : "",
          provider: "semantic-scholar",
        },
      ];
    });
  },
};

const openAlex: SourceProvider = {
  name: "openalex",
  async search(keywords, query) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", [query, ...keywords].filter(Boolean).join(" "));
    url.searchParams.set("per-page", "3");
    const response = await fetchWithRetry(url.toString());
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) {
      throw new Error("OpenAlex returned an invalid response.");
    }
    return data.results.slice(0, 3).flatMap((work): Source[] => {
      if (!work || typeof work !== "object") return [];
      const item = work as Record<string, unknown>;
      if (typeof item.title !== "string" || !item.title) return [];
      const authorships = Array.isArray(item.authorships) ? item.authorships : [];
      const authors = authorships
        .flatMap((authorship) => {
          if (!authorship || typeof authorship !== "object" || !("author" in authorship)) return [];
          const author = authorship.author;
          return author && typeof author === "object" && "display_name" in author
            ? [String(author.display_name)]
            : [];
        })
        .join(", ");
      const doi =
        typeof item.doi === "string"
          ? item.doi
          : typeof item.id === "string"
            ? item.id
            : "";
      if (!doi) return [];
      return [
        {
          title: item.title,
          authors,
          year: typeof item.publication_year === "number" ? item.publication_year : null,
          url: doi,
          snippet: "",
          provider: "openalex",
        },
      ];
    });
  },
};

export async function searchSources(
  keywords: string[],
  query: string,
  proxyMode: boolean,
  proxyUrl: string,
): Promise<Source[]> {
  const errors: string[] = [];
  if (proxyMode && proxyUrl) {
    try {
      const response = await fetch(`${proxyUrl.replace(/\/+$/, "")}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, query }),
      });
      if (!response.ok) throw new Error(`Proxy source search failed (${response.status}).`);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("sources" in data) || !Array.isArray(data.sources)) {
        throw new Error("Proxy returned an invalid sources response.");
      }
      if (!data.sources.every(isSource)) throw new Error("Proxy returned malformed source data.");
      const scholar = data.sources.filter(
        (source): source is Source =>
          !!source &&
          typeof source === "object" &&
          "provider" in source &&
          source.provider === "google-scholar",
      );
      if (scholar.length) return scholar.slice(0, 3);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Google Scholar search failed.");
    }
  }

  for (const provider of [semanticScholar, openAlex]) {
    try {
      const sources = await provider.search(keywords, query);
      if (sources.length) return sources.slice(0, 3);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${provider.name} search failed.`);
    }
  }
  if (errors.length) throw new Error(`No scholarly sources could be retrieved. ${errors.join(" ")}`);
  return [];
}
