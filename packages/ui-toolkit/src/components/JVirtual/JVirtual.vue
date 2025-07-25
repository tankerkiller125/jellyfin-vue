<template>
  <Component
    :is="tag"
    ref="rootRef"
    :style="rootStyles">
    <Component
      :is="probeTag"
      ref="probeRef"
      class="uno-pointer-events-none uno-invisible uno-z--1 uno-place-self-stretch"
      :class="gridClass">
      <slot :item="items[0]" />
    </Component>
    <template v-if="visibleItemsLength">
      <template
        v-for="comp_index in visibleItemsLength"
        :key="getKey?.(items[visibleItems[comp_index - 1]!.index] as T)">
        <JSlot
          v-if="
            visibleItems[comp_index - 1] &&
              items[visibleItems[comp_index - 1]!.index] &&
              visibleItems[comp_index - 1]!.style"
          class="uno-transform-gpu"
          :class="gridClass"
          :style="visibleItems[comp_index - 1]!.style">
          <slot
            :item="items[visibleItems[comp_index - 1]!.index]!"
            :index="visibleItems[comp_index - 1]!.index" />
        </JSlot>
      </template>
    </template>
  </Component>
</template>

<script lang="ts">
import {
  refDebounced,
  useEventListener,
  useResizeObserver
} from '@vueuse/core';
import {
  computed,
  shallowRef,
  watch,
  type StyleValue,
  useTemplateRef,
  onScopeDispose
} from 'vue';
import { releaseProxy, wrap } from 'comlink';
import { isNil, isUndef } from '@jellyfin-vue/shared/validation';
import {
  getBufferMeta,
  getContentSize,
  getResizeMeasurement,
  getScrollParents,
  getScrollToInfo,
  type InternalItem
} from './pipeline';
import type { IJVirtualWorker } from './j-virtual.worker';
import JVirtualWorker from './j-virtual.worker?worker';
import { windowSize } from '#/store';
import JSlot from '#/components/JSlot.vue';
import { toPx } from '#/util/helpers';

/**
 * SHARED STATE ACROSS ALL THE COMPONENT INSTANCES
 */

const displayWidth = refDebounced(windowSize.width, 250);
const displayHeight = refDebounced(windowSize.height, 250);
</script>

<script setup lang="ts" generic="T">
/**
 * BASED ON VUE-VIRTUAL-SCROLL-GRID: https://github.com/rocwang/vue-virtual-scroll-grid
 *
 * Key differences from that module and this (some changes are going to be upstreamed so might appear in the future in the module):
 * - Improvements in the scan area (keep the offset centered to items already in view)
 * - Removed unnecessary manipulations (like the ones performed in accumulateBuffer)
 * - No ramda or Rxjs, making the bundle lighter.
 * - Full virtual scroll, no virtual + infinite scroll (as all the items are fetched from the server and we don't have pagination)
 * - Vue instance reuse
 * - No need for probe slot, default to first default slot
 * - Type support for the data that must be passed to the virtualized component's instances
 * - Improved documentation and comments
 */
const {
  items,
  tag = 'div',
  probeTag = 'div',
  bufferMultiplier = 1.2,
  scrollTo,
  grid,
  getKey
} = defineProps<{
  items: T[];
  /**
   * Element to use as a container for the virtualized elements
   * @default 'div'
   */
  tag?: string;
  /**
   * Element to use for probing the rest of the elements
   * @default 'div'
   */
  probeTag?: string;
  /**
   * Items to buffer in the view. By default, the same amount of items that fit on the screen
   * are buffered above and below the visible area.
   * @default 1
   */
  bufferMultiplier?: number;
  /**
   * Item index to scroll to. It just scrolls to the item on change, it doesn't lock screen to it.
   */
  scrollTo?: number;
  /**
   * Whether to use a grid layout
   */
  grid?: boolean;
  /**
   * Updates the content by using the index as key. This is useful in case the inner content
   * doesn't react properly to changes in the data.
   */
  getKey?: (item: T) => unknown;
}>();

/**
 * == TEMPLATE REFS ==
 */
const rootRef = useTemplateRef<HTMLElement>('rootRef');
const probeRef = useTemplateRef<HTMLElement>('probeRef');

/**
 * == STATE REFS ==
 */
const itemRect = shallowRef<DOMRectReadOnly>();
const scrollEvents = shallowRef(0);
const workerUpdates = shallowRef(0);

/**
 * == NON REACTIVE STATE ==
 */
const workerInstance = new JVirtualWorker();
const worker = wrap<IJVirtualWorker>(workerInstance);
const cache = new Map<number, InternalItem[]>();

/**
 * == MEASUREMENTS OF THE GRID AREA AND STYLING ==
 * In the if check of each computed property we add all the objects that we want
 * Vue to track for changes. If we don't do this, Vue will not track the dependencies
 * correctly.
 */
const gridClass = computed(() => grid ? 'j-virtual-grid-area' : undefined);
const itemsLength = computed(() => items.length);
const resizeMeasurement = computed(() => {
  return rootRef.value
    && itemRect.value
    && !isUndef(displayWidth.value)
    && !isUndef(displayHeight.value)
    && !isUndef(items)
    ? getResizeMeasurement(rootRef.value, itemRect.value)
    : undefined;
});
const contentSize = computed(() => {
  return resizeMeasurement.value
    && !isUndef(displayWidth.value)
    && !isUndef(displayHeight.value)
    && !isUndef(items)
    ? getContentSize(resizeMeasurement.value, itemsLength.value)
    : undefined;
});
const rootStyles = computed<StyleValue>(() => ({
  ...(!isNil(contentSize.value?.height) && { height: toPx(contentSize.value.height) }),
  ...(!isNil(contentSize.value?.width) && { width: toPx(contentSize.value.width) }),
  placeContent: 'start'
}));
  /**
   * Cache internal properties instead of passing them as objects, as using the objects directly will lead to firing the computed properties' effects
   * even if they haven't changed (since returning a object is always a new object and there's no proper way in Javascript to compare objects).
   */
const boundingClientRect = computed(() => {
  if (
    !isUndef(displayWidth.value)
    && !isUndef(displayHeight.value)
    && !isNil(rootRef.value)
    && !isUndef(scrollEvents.value)
    && !isUndef(items)
  ) {
    return rootRef.value.getBoundingClientRect();
  }
});
const leftSpaceAroundWindow = computed(() => Math.abs(Math.min(boundingClientRect.value?.left ?? 0, 0)));
const topSpaceAroundWindow = computed(() => Math.abs(Math.min(boundingClientRect.value?.top ?? 0, 0)));
const bufferMeta = computed(() => {
  if (!isUndef(resizeMeasurement.value)) {
    return getBufferMeta(
      {
        left: leftSpaceAroundWindow.value,
        top: topSpaceAroundWindow.value
      },
      resizeMeasurement.value,
      bufferMultiplier
    );
  }
});
const bufferLength = computed(() => Math.ceil(bufferMeta.value?.bufferedLength ?? 0));
const bufferOffset = computed(() => Math.ceil(bufferMeta.value?.bufferedOffset ?? 0));
const visibleItems = computed<InternalItem[]>((previous) => {
  if (Number.isFinite(workerUpdates.value) && Number.isFinite(scrollEvents.value)) {
    const elems = cache.get(bufferOffset.value) ?? [];

    return elems.length ? elems : previous ?? [];
  }

  return [];
});
const visibleItemsLength = computed(() => visibleItems.value.length);
const scrollParents = computed(() => rootRef.value && getScrollParents(rootRef.value));
const scrollTargets = computed(() => {
  if (scrollParents.value) {
    const { vertical, horizontal } = scrollParents.value;

    /**
     * If the scrolling parent is the doc root, use window instead as using
     * document root might not work properly.
     */
    return (
      vertical === horizontal ? [vertical] : [vertical, horizontal]
    ).map(parent =>
      (parent === document.documentElement ? globalThis : parent)
    );
  }
});

/**
 * == VIRTUAL SCROLLING LOGIC ==
 */
useResizeObserver(probeRef, (entries) => {
  itemRect.value = entries[0]?.contentRect;
});

const populateCache = (() => {
  /**
   * Sets the cache
   * Only to be used inside populateCache, since nullish checks are skipped here
   */
  async function setCache(offset: number): Promise<void> {
  /**
   * Set the cache value rightaway to an empty value.
   * That way, populateCache loop doesn't fire again
   * with the same offset before this promise resolves.
   */
    cache.set(offset, []);

    const values = await worker.getVisibleIndexes(
      { bufferedLength: bufferLength.value, bufferedOffset: offset },
      resizeMeasurement.value!,
      itemsLength.value
    );

    /**
     * If the WebWorker operation was running in the middle of a cache clear,
     * old data might be pushed instead, so we avoid it here.
     */
    globalThis.requestAnimationFrame(() => {
      if (cache.size !== 0) {
        cache.set(offset, values);
        workerUpdates.value++;
      }
    });
  }

  /**
   * Handles all the logic for caching the virtual scrolling items and
   * the interaction with the worker.
   *
   * We cache the items to avoid the extra overhead of sending the items
   * to the worker when scrolling fast. We cache 2 times the buffer length
   */
  return function (): void {
    if (!isUndef(resizeMeasurement.value)
      && Number.isFinite(bufferLength.value)
      && Number.isFinite(bufferOffset.value)
    ) {
      const area = bufferLength.value * 2;
      const start = Math.max(1, bufferOffset.value - area);
      const finish = bufferOffset.value + area;

      /**
       * We always populate 0 first, so there's no blank space shown at the beginning
       * or when scrolling to top after a resize in the bottom area.
       */
      if (!cache.has(0)) {
        void setCache(0);
      }

      for (let i = finish; i >= start && !cache.has(i); i--) {
      /**
       * Fire all the operations concurrently, no need to await them
       */
        void setCache(i);
      }
    }
  };
})();

useEventListener(scrollTargets, 'scroll', () => {
  globalThis.requestAnimationFrame(() => scrollEvents.value++);
}, {
  passive: true,
  capture: true
});

/**
 * Tracks if the scroll must be pointed at an specific element
 */
watch(() => scrollTo, () => {
  if (!isNil(rootRef.value)
    && !isUndef(scrollTo)
    && !isUndef(resizeMeasurement.value)
    && !isNil(scrollParents.value)
    && scrollTo > 0
    && scrollTo < itemsLength.value) {
    const { target, top, left } = getScrollToInfo(scrollParents.value, rootRef.value, resizeMeasurement.value, scrollTo);

    target.scrollTo({ top, left, behavior: 'smooth' });
  }
});

/**
 * Populate and reset the cache according to the current buffer state
 */
watch([bufferLength, resizeMeasurement, itemsLength, bufferOffset], (val, oldVal) => {
  if (val[0] !== oldVal[0] || val[1] !== oldVal[1] || val[2] !== oldVal[2]) {
    cache.clear();
  }

  populateCache();
});

onScopeDispose(() => {
  worker[releaseProxy]();
  workerInstance.terminate();
});
</script>

<style scoped>
:deep(.j-virtual-grid-area) {
  grid-area: 1/1;
}
</style>
