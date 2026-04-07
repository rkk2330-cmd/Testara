import { NextResponse } from "next/server";
import { withHandler } from "@/lib/core";
import { pluginEngine, registerBuiltinPlugins } from "@/lib/plugins";

let initialized = false;

export const GET = withHandler(async () => {
  if (!initialized) { await registerBuiltinPlugins(pluginEngine); initialized = true; }
  return NextResponse.json({
    data: {
      plugins: pluginEngine.getRegisteredPlugins(),
      registered_actions: pluginEngine.getRegisteredActions(),
      total_plugins: pluginEngine.getRegisteredPlugins().length,
    },
  });
});
