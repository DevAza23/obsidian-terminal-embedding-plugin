import esbuild from "esbuild";

const banner = `
/*
THIS IS A GENERATED BUNDLE. RUN \`npm run build\` TO REBUILD.
*/
`;

const ctx = await esbuild.context({
	banner: {
		js: banner,
	},
	bundle: true,
	entryPoints: ["src/main.ts"],
	external: ["obsidian", "electron", "node-pty", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
	format: "cjs",
	logLevel: "info",
	outfile: "main.js",
	platform: "node",
	sourcemap: "inline",
	target: "node18",
});

if (process.argv.includes("--watch")) {
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
