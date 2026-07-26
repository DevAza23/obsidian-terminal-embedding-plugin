import esbuild from "esbuild";

const banner = `
/*
THIS IS A GENERATED BUNDLE. RUN \`npm run build\` TO REBUILD.
*/
`;

const watch = process.argv.includes("--watch");
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
	minify: !watch,
	sourcemap: watch ? "inline" : false,
	target: "node18",
});

if (watch) {
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
