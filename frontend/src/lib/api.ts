const API_URL = import.meta.env.DEV ? "" : "https://api.ymkw.top";
const SSR_API_URL = import.meta.env.PUBLIC_API_URL || "https://api.ymkw.top";

interface FetchAPIOptions extends Omit<RequestInit, 'signal'> {
    timeout?: number;
    retries?: number;
}

export class APIError extends Error {
    status: number;
    url: string;

    constructor(message: string, status: number, url: string) {
        super(message);
        this.name = "APIError";
        this.status = status;
        this.url = url;
    }
}

export async function fetchAPI(
    path: string,
    options: FetchAPIOptions = {}
): Promise<Response> {
    const { retries = 2, ...fetchOptions } = options;
    const isServer = typeof window === "undefined";
    const baseUrl = isServer ? SSR_API_URL : API_URL;
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    const headers: Record<string, string> = {
        ...(isServer ? { Referer: "https://www.ymkw.top/" } : {}),
        ...((fetchOptions.headers as Record<string, string>) || {}),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                ...fetchOptions,
                headers,
                credentials: fetchOptions.credentials ?? "include",
            });

            if (res.ok || res.status === 404) return res;
            const apiError = new APIError(`HTTP ${res.status}`, res.status, url);
            lastError = apiError;

            if (res.status === 429 || res.status >= 500) {
                if (attempt < retries) {
                    await delay(1000 * Math.pow(2, attempt));
                    continue;
                }
            }

            throw apiError;
        } catch (err) {
            if (!(err instanceof APIError)) {
                lastError = new APIError(err instanceof Error ? err.message : "Network failure", 0, url);
                if (err instanceof Error) {
                    lastError.name = err.name;
                }
            } else {
                lastError = err;
            }

            if (attempt < retries) {
                await delay(1000 * Math.pow(2, attempt));
                continue;
            }
        }
    }

    if (lastError) throw lastError;
    throw new Error("Fetch failed after retries");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { API_URL };
