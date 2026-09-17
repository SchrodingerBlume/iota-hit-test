// citation-js 的核心为了拉远程条目带了 node 才有的 sync-fetch / node-fetch；站内只用它排 BibTeX，这两处替成空的
const noFetch = () => { throw new Error('fetch is not available in iota4web'); };
export default noFetch;
export const Headers = globalThis.Headers;
