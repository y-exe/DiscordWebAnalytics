import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
config.buildCommand = "npm run build:cloudflare";

export default config;
