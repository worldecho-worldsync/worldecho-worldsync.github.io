/** Four simultaneous background recordings share a single playback choice. */
export class HeroReel {
  constructor(root, { reducedMotion = false, visible = true, documentVisible = true } = {}) {
    this.root = root;
    this.videos = Array.from(root.querySelectorAll("[data-hero-video]"));
    this.toggle = root.querySelector("[data-hero-toggle]");
    this.wanted = !reducedMotion;
    this.visible = visible;
    this.documentVisible = documentVisible;
    this.version = 0;
    const controls = root.querySelector("[data-hero-controls]");
    if (controls) controls.hidden = false;
    this.toggle?.addEventListener("click", () => {
      this.wanted = !this.wanted;
      this.refresh();
    });
    this.videos.forEach((video) => {
      video.hidden = false;
      video.muted = true;
      video.loop = true;
      video.playbackRate = 1;
      const startAt = Number(video.dataset.heroStart);
      if (Number.isFinite(startAt) && startAt > 0) {
        const seekToSelectedFrame = () => {
          const target = Number.isFinite(video.duration)
            ? Math.min(startAt, Math.max(0, video.duration - 0.1))
            : startAt;
          // Some simple static servers do not support byte-range requests.
          // Starting at zero keeps those previews playable instead of failing autoplay.
          if (!video.seekable?.length || video.seekable.end(video.seekable.length - 1) < target) return;
          video.currentTime = target;
        };
        if (video.readyState >= 1) seekToSelectedFrame();
        else video.addEventListener("loadedmetadata", seekToSelectedFrame, { once: true });
      }
      video.addEventListener("error", () => {
        this.wanted = false;
        this.refresh();
      });
    });
    this.refresh();
  }

  get canPlay() { return this.wanted && this.visible && this.documentVisible; }

  setVisible(visible) { this.visible = visible; this.refresh(); }
  setDocumentVisible(visible) { this.documentVisible = visible; this.refresh(); }
  setReducedMotion(reduced) {
    if (reduced) this.wanted = false;
    this.refresh();
  }

  refresh() {
    const version = ++this.version;
    if (this.toggle) this.toggle.textContent = this.wanted ? "Pause background" : "Play background";
    if (!this.canPlay) {
      this.videos.forEach((video) => video.pause());
      return;
    }
    const attempts = this.videos.map((video) => {
      try { return Promise.resolve(video.play()); }
      catch (error) { return Promise.reject(error); }
    });
    Promise.all(attempts).then(() => {
      // All clips loop independently; no frame or duration alignment is implied.
      if (!this.canPlay) this.videos.forEach((video) => video.pause());
    }).catch(() => {
      if (version !== this.version) return;
      this.wanted = false;
      this.refresh();
    });
  }
}

/** Native controls own user intent; visibility pauses never overwrite it. */
export class GalleryRecording {
  constructor(video, { reducedMotion = false, visible = true, documentVisible = true } = {}) {
    this.video = video;
    this.wanted = !reducedMotion;
    this.visible = visible;
    this.documentVisible = documentVisible;
    this.automaticPauses = 0;
    this.pendingPlay = null;
    this.version = 0;
    video.muted = true;
    video.loop = true;
    video.playbackRate = 1;
    video.addEventListener("play", () => {
      if (!this.pendingPlay) this.wanted = true;
      if (!this.canPlay) this.pauseAutomatically();
    });
    video.addEventListener("pause", () => {
      if (this.automaticPauses) this.automaticPauses -= 1;
      else {
        this.wanted = false;
        this.version += 1;
      }
    });
    video.addEventListener("error", () => {
      this.wanted = false;
      this.refresh();
    });
    this.refresh();
  }

  get canPlay() { return this.wanted && this.visible && this.documentVisible; }
  setVisible(visible) { this.visible = visible; this.refresh(); }
  setDocumentVisible(visible) { this.documentVisible = visible; this.refresh(); }
  setReducedMotion(reduced) {
    if (reduced) this.wanted = false;
    this.refresh();
  }

  pauseAutomatically() {
    // pause() queues an event only when transitioning from playing to paused.
    // Count those queued events so a real click on native Pause stays paused.
    if (!this.video.paused) {
      this.automaticPauses += 1;
      this.video.pause();
    }
  }

  refresh() {
    if (!this.canPlay) {
      this.version += 1;
      this.pauseAutomatically();
      return;
    }
    if (!this.video.paused) return;
    const version = ++this.version;
    const request = {};
    this.pendingPlay = request;
    let attempt;
    try { attempt = this.video.play(); }
    catch (error) { attempt = Promise.reject(error); }
    Promise.resolve(attempt).then(() => {
      if (this.pendingPlay === request) this.pendingPlay = null;
      if (!this.canPlay) this.pauseAutomatically();
    }).catch(() => {
      if (this.pendingPlay === request) this.pendingPlay = null;
      if (version !== this.version) return;
      this.wanted = false;
      this.pauseAutomatically();
    });
  }
}

export function setupRealWorldDemos() {
  const root = document.querySelector("[data-hero-reel]");
  if (!root) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observable = "IntersectionObserver" in window;
  const reel = new HeroReel(root, {
    reducedMotion: reducedMotion.matches,
    documentVisible: !document.hidden,
    visible: !observable,
  });
  const gallery = new Map(Array.from(document.querySelectorAll("[data-real-world-video]"), (video) => [
    video,
    new GalleryRecording(video, {
      reducedMotion: reducedMotion.matches,
      documentVisible: !document.hidden,
      visible: !observable,
    }),
  ]));
  if (observable) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === root) reel.setVisible(entry.isIntersecting);
        else gallery.get(entry.target)?.setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.25);
      });
    }, { threshold: [0, 0.01, 0.25] });
    observer.observe(root);
    gallery.forEach((_, video) => observer.observe(video));
  }
  document.addEventListener("visibilitychange", () => {
    reel.setDocumentVisible(!document.hidden);
    gallery.forEach((recording) => recording.setDocumentVisible(!document.hidden));
  });
  reducedMotion.addEventListener("change", (event) => {
    reel.setReducedMotion(event.matches);
    gallery.forEach((recording) => recording.setReducedMotion(event.matches));
  });
  return reel;
}
