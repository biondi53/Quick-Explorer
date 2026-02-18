# Feasibility: Central Panel Tab Animation

It is **fully feasible** to replicate the tab switching animation in the central panel using the existing `framer-motion` library.

## Implementation Strategy

1.  **Wrap Content**: Wrap the `FileGrid` / `FileTable` conditional rendering in `<AnimatePresence mode="wait">`.
2.  **Keyed Container**: Create a `<motion.div>` container for the views, setting `key={currentTab.id}`. This forces React to unmount the old view and mount the new one on tab change.
3.  **Animation Variants**: Define variants for `enter`, `center`, and `exit`.
    *   **Enter**: x-offset (e.g., 50px), opacity 0.
    *   **Center**: x: 0, opacity 1.
    *   **Exit**: x-offset (e.g., -50px), opacity 0.
4.  **Direction**: Ideally, track the index of the tabs to know if we are navigating "left" or "right" to set the slide direction accordingly.

## Code Example

```tsx
<AnimatePresence mode="wait" custom={direction}>
  <motion.div
    key={currentTab.id}
    custom={direction}
    variants={variants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={{ type: "spring", stiffness: 300, damping: 30 }}
    className="flex-1 overflow-hidden" // Essential to contain the slide
  >
    {currentTab.viewMode === 'grid' ? <FileGrid ... /> : <FileTable ... />}
  </motion.div>
</AnimatePresence>
```

## Considerations
*   **Performance**: Animating large DOM trees (like a table with 5000 rows) can be heavy. We might need `will-change: transform`.
*   **Scroll Position**: We need to ensure scroll position is handled correctly (reset on new tab, preserved if going back/forward).
