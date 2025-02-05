import { watchImmediate } from '@vueuse/core';
import { getCurrentScope, toRef, type MaybeRefOrGetter } from 'vue';

/**
 * When the passed argument is truthy, the effect scope of the current component will be paused
 * until the argument becomes falsy again.
 *
 * This is useful for components that need to pause the DOM patching
 */
export function usePausableEffect(signal: MaybeRefOrGetter<boolean>) {
  const scope = getCurrentScope();

  if (scope) {
    watchImmediate(toRef(signal), val => val ? scope.pause() : scope.resume(), { flush: 'sync' });
  }
}
