
import { emitRuntimeAudit } from '../runtime/forensic-log-sink';

declare global {
  interface Window {
    MathJax: any;
  }
}

let activeTexJax: any = null;
const texJaxTokens = new WeakMap<any, number>();
let nextTexJaxToken = 1;

export function getActiveTexJax() {
    if (activeTexJax) return activeTexJax;

    if (typeof window === 'undefined' || !window.MathJax) return null;
    const doc = window.MathJax.startup?.document;
    if (!doc?.inputJax) return null;

    for (const jax of doc.inputJax) {
        if (jax.name === 'TeX') {
            activeTexJax = jax;
            if (!texJaxTokens.has(jax)) {
                texJaxTokens.set(jax, nextTexJaxToken++);
            }
            emitRuntimeAudit('MATHJAX-ACTIVE-TEX-JAX', {
                decision: 'FOUND',
                texInputJaxToken: texJaxTokens.get(jax),
                priority: jax.priority,
                packages: jax.packages?.packageNames() ?? [],
            });
            return jax;
        }
    }

    emitRuntimeAudit('MATHJAX-ACTIVE-TEX-JAX', { decision: 'NOT_FOUND' });
    return null;
}

export function verifyPrefilterInstallation(filterFn: Function) {
    const jax = getActiveTexJax();
    if (!jax) {
        emitRuntimeAudit('MATHJAX-PREFILTER-REGISTRY', { decision: 'JAX_NOT_FOUND' });
        return;
    }

    const registry = jax.preFilters?.filter;
    const registrySnapshot = registry ? registry.toString() : 'UNAVAILABLE';
    const match = registry ? jax.preFilters.find((p: any) => p.name === filterFn.name) : undefined;

    emitRuntimeAudit('MATHJAX-PREFILTER-REGISTRY', {
        decision: registry ? (match ? 'PASS' : 'DEGRADED') : 'UNAVAILABLE',
        texInputJaxToken: texJaxTokens.get(jax),
        registrySnapshot,
        inkChapterFilterMatchCount: match ? 1 : 0,
        filterName: filterFn.name,
    });
}
