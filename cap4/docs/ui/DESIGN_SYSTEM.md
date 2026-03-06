# Design System

Component library and UI patterns for cap4.

---

## Color Palette

```
Primary:       #0070F3 (Blue)
Secondary:     #7928CA (Purple)
Success:       #17C950 (Green)
Warning:       #F5A623 (Orange)
Danger:        #F81E1E (Red)
Background:    #FFFFFF (White)
Text:          #111111 (Black)
Border:        #E5E5E5 (Light Gray)
```

---

## Typography

### Font Family
- UI: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Mono: "SF Mono", Monaco, monospace

### Sizes
- h1: 32px, weight 600
- h2: 24px, weight 600
- h3: 20px, weight 600
- body: 16px, weight 400
- small: 14px, weight 400
- xs: 12px, weight 400

---

## Components

### Button

```tsx
<Button variant="primary">Upload Video</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>
<Button disabled>Processing...</Button>
```

**Variants:** primary, secondary, danger, ghost

### Input

```tsx
<Input 
  type="text"
  placeholder="Enter title"
  value={title}
  onChange={(e) => setTitle(e.target.value)}
/>

<Input 
  type="file"
  accept="video/mp4"
  onChange={(e) => handleUpload(e.target.files[0])}
/>
```

### Card

```tsx
<Card>
  <Card.Header>Video Status</Card.Header>
  <Card.Body>
    {/* Content */}
  </Card.Body>
  <Card.Footer>
    {/* Footer content */}
  </Card.Footer>
</Card>
```

### Badge

```tsx
<Badge color="success">Complete</Badge>
<Badge color="warning">Processing</Badge>
<Badge color="danger">Failed</Badge>
```

### Progress Bar

```tsx
<Progress value={75} />
<Progress value={50} animated />
```

### Modal

```tsx
<Modal open={isOpen} onClose={onClose}>
  <Modal.Header>Confirm Delete</Modal.Header>
  <Modal.Body>Are you sure?</Modal.Body>
  <Modal.Footer>
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="danger" onClick={onDelete}>Delete</Button>
  </Modal.Footer>
</Modal>
```

### Alert

```tsx
<Alert variant="success">Upload successful!</Alert>
<Alert variant="warning">Processing may take a few minutes</Alert>
<Alert variant="danger">An error occurred</Alert>
<Alert variant="info">Click to expand details</Alert>
```

---

## Patterns

### Upload Flow

1. User clicks "Upload Video" button
2. File picker opens (accepts .mp4)
3. File is selected → progress bar shows upload
4. On success → redirect to status page
5. On error → show error alert, allow retry

### Status Display

```
Phase: "uploading"     → Show upload progress (0-100%)
Phase: "queued"        → Show "Waiting to process..."
Phase: "processing"    → Show processing progress
Phase: "transcribing"  → Show "Transcribing audio..."
Phase: "generating_ai" → Show "Generating metadata..."
Phase: "complete"      → Show completed state
Phase: "failed_*"      → Show error with retry button
```

### Chapter Navigation

```
[Chapter List Panel]
├─ 00:00:00 - Introduction
├─ 00:02:15 - Setup
├─ 00:05:30 - Demo
└─ 00:12:00 - Q&A

Clicking a chapter seeks video to that timestamp
Current chapter is highlighted during playback
```

### Transcript Display

```
[Full Transcript]
Paragraph view, formatted as readable text
Click timestamp to seek video
Can copy/paste transcript
```

### Video Player

Standard HTML5 video player with:
- Play/pause controls
- Progress bar (seekable)
- Volume control
- Fullscreen button
- Chapter navigation overlay
- Transcript sidebar

---

## Responsive Design

### Breakpoints

```
xs: 0px    (mobile)
sm: 640px  (tablet)
md: 1024px (desktop)
lg: 1280px (large desktop)
```

### Mobile Layout (xs)

- Single column
- Chapters below video
- Transcript below chapters
- Full width controls

### Desktop Layout (md+)

- Video + chapters side-by-side
- Transcript below
- Compact controls

---

## Accessibility

### WCAG 2.1 Level AA

- [ ] Semantic HTML (nav, main, article, etc.)
- [ ] ARIA labels for icons
- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Color contrast ratios > 4.5:1
- [ ] Focus indicators visible
- [ ] Alt text for images
- [ ] Video captions/subtitles

### Screen Reader Support

```tsx
<button aria-label="Upload video">
  <UploadIcon />
</button>

<video>
  <track kind="captions" src="captions.vtt" />
</video>
```

---

## Dark Mode (Future)

```
Dark Background:  #111111
Dark Text:        #FFFFFF
Dark Border:      #333333
Dark Card:        #1A1A1A
```

---

## Animation

### Transitions
- Default: 200ms ease-in-out
- Fast: 100ms ease-in-out
- Slow: 300ms ease-in-out

### Loading States
- Skeleton screens while fetching
- Progress bars during processing
- Spinners during async operations

---

## Error Handling

### Alert Types

```
info:    Information message (blue)
success: Operation succeeded (green)
warning: Caution required (orange)
danger:  Error occurred (red)
```

### Error Messages

- Clear, user-friendly language
- Suggest action (retry, contact support, etc.)
- Include error code for debugging

Example:
```
Error: Failed to process video
Code: MEDIA_SERVER_TIMEOUT
Action: The video processing timed out. 
Please retry in a few minutes.
```

---

## File Structure

```
apps/web/src/
├── components/
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Input.tsx
│   ├── Modal.tsx
│   ├── Alert.tsx
│   ├── Progress.tsx
│   ├── Badge.tsx
│   └── VideoPlayer.tsx
│
├── pages/
│   ├── UploadPage.tsx
│   ├── VideoPage.tsx
│   └── ErrorPage.tsx
│
├── hooks/
│   ├── useVideo.ts
│   └── useUpload.ts
│
└── styles/
    ├── globals.css
    ├── colors.css
    └── animations.css
```

---

## Testing Components

```typescript
// Example test
test('Button renders with correct text', () => {
  render(<Button>Click me</Button>);
  expect(screen.getByText('Click me')).toBeInTheDocument();
});

// Example story (Storybook)
export default {
  title: 'Components/Button',
  component: Button,
};

export const Primary = () => <Button variant="primary">Primary</Button>;
export const Secondary = () => <Button variant="secondary">Secondary</Button>;
```

---

## Performance Tips

- **Lazy load video player** — Only load when visible
- **Image optimization** — Use WebP with JPEG fallback
- **Bundle splitting** — Separate code for each page
- **Caching** — Cache processed videos (headers)

---

## Future Improvements

- [ ] Dark mode support
- [ ] Custom themes
- [ ] Storybook for component library
- [ ] Accessibility audit
- [ ] Animation polish
- [ ] Mobile app version (React Native)

---

**Questions?** See [../../CONTRIBUTING.md](../../CONTRIBUTING.md) or open GitHub issue
