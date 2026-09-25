/* One timeline and one playback intent for each comparison. */
export class VideoGroup {
  constructor(root, options = {}) {
    this.root = root;
    this.videos = Array.from(root.querySelectorAll("video"));
    this.toggle = root.querySelector("[data-playback-toggle]");
    this.restartButton = root.querySelector("[data-playback-restart]");
    this.status = root.querySelector("[data-playback-status]");
    this.slider = root.querySelector("[data-playback-seek]");
    this.time = root.querySelector("[data-playback-time]");
    this.requestFrame = options.requestFrame || ((callback) => window.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame || ((id) => window.cancelAnimationFrame(id));
    this.visible = options.visible ?? true;
    this.documentVisible = options.documentVisible ?? true;
    this.reducedMotion = options.reducedMotion ?? false;
    this.wanted = !this.reducedMotion;
    this.playing = false;
    this.starting = false;
    this.replacing = false;
    this.version = 0;
    this.frame = null;
    this.position = 0;
    this.errorMessage = "";

    this.toggle?.addEventListener("click", () => this.wanted ? this.pause() : this.play());
    this.restartButton?.addEventListener("click", () => this.restart());
    this.slider?.addEventListener("input", () => this.seek(Number(this.slider.value)));
    this.videos.forEach((video) => {
      video.muted = true;
      video.defaultMuted = true;
      video.loop = false;
      video.autoplay = false;
      video.controls = false;
      for (const event of ["loadedmetadata", "durationchange", "canplay", "canplaythrough", "seeked", "waiting"]) {
        video.addEventListener(event, () => this.refresh());
      }
      video.addEventListener("ended", () => {
        if (this.wanted) this.seek(0);
        else this.refresh();
      });
      const onError = () => {
        // A queued error from a replaced source is irrelevant after load() clears it.
        if (!video.error || this.replacing) return;
        this.fail("One clip could not load. Select Play comparison to retry.");
      };
      video.addEventListener("error", onError);
      // With <source> children, unsupported sources can report their error on
      // the source element instead of on the parent video.
      video.querySelectorAll("source").forEach((source) => source.addEventListener("error", () => {
        if (!this.replacing) {
          this.fail("One clip could not load. Select Play comparison to retry.");
        }
      }));
    });
    const controls = root.querySelector(".playback-controls");
    if (controls) controls.hidden = false;
    if (this.videos.some((video) => video.error || video.networkState === 3)) {
      this.fail("One clip could not load. Select Play comparison to retry.");
    } else this.refresh();
  }

  get duration() {
    const durations = this.videos.map((video) => video.duration);
    return durations.length && durations.every((value) => Number.isFinite(value) && value > 0)
      ? Math.max(...durations) : 0;
  }

  get ready() {
    return this.duration > 0 && this.videos.every((video) => video.readyState >= 3 && !video.seeking && !video.error);
  }

  get canPlay() {
    return this.wanted && this.visible && this.documentVisible && !this.errorMessage && !this.replacing;
  }

  stopMedia() {
    this.version += 1;
    this.starting = false;
    this.playing = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.videos.forEach((video) => video.pause());
  }

  play() {
    this.wanted = true;
    if (this.errorMessage) {
      this.replaceSources(() => {});
      return;
    }
    this.refresh();
  }

  pause() {
    this.wanted = false;
    this.stopMedia();
    this.render();
  }

  restart() {
    // Restart preserves a deliberate pause; Play remains a separate action.
    this.seek(0);
  }

  seek(percent) {
    if (!this.duration || this.errorMessage || !Number.isFinite(percent)) return;
    this.stopMedia();
    const fraction = Math.max(0, Math.min(100, percent)) / 100;
    this.position = Math.min(this.duration - 0.001, this.duration * fraction);
    this.videos.forEach((video) => { video.currentTime = this.position / this.duration * video.duration; });
    this.refresh();
  }

  replaceSources(updateSources) {
    // Invalidate every outstanding play promise before changing any source.
    this.stopMedia();
    this.replacing = true;
    this.position = 0;
    this.errorMessage = "";
    try {
      updateSources();
      this.videos.forEach((video) => video.load());
    } finally {
      this.replacing = false;
    }
    this.refresh();
  }

  setVisible(visible) {
    this.visible = visible;
    this.refresh();
  }

  setDocumentVisible(visible) {
    this.documentVisible = visible;
    this.refresh();
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    if (reduced) this.wanted = false;
    this.refresh();
  }

  fail(message) {
    this.errorMessage = message;
    this.wanted = false;
    this.stopMedia();
    this.render();
  }

  refresh() {
    if (this.replacing) return;
    if (!this.canPlay || !this.ready) {
      if (this.playing || this.starting) this.stopMedia();
      this.render();
      return;
    }
    if (!this.playing && !this.starting) this.start();
    else this.render();
  }

  start() {
    this.starting = true;
    const version = ++this.version;
    // Resume all streams from the same point before requesting playback.
    const target = Math.min(this.position, Math.max(0, this.duration - 0.001));
    this.videos.forEach((video) => {
      video.playbackRate = video.duration / this.duration;
      const clipTime = target / this.duration * video.duration;
      if (Math.abs(video.currentTime - clipTime) > 0.025) video.currentTime = clipTime;
    });
    if (!this.ready) {
      this.starting = false;
      this.render();
      return;
    }
    this.render();
    const attempts = this.videos.map((video) => {
      try { return Promise.resolve(video.play()); }
      catch (error) { return Promise.reject(error); }
    });
    Promise.all(attempts).then(() => {
      if (version !== this.version) return;
      this.starting = false;
      if (!this.canPlay || !this.ready) {
        this.stopMedia();
        this.refresh();
        return;
      }
      if (this.videos.some((video) => video.paused)) {
        this.fail("Playback paused. Select Play comparison to retry.");
        return;
      }
      this.playing = true;
      this.render();
      this.tick();
    }).catch(() => {
      if (version !== this.version) return;
      this.fail("Playback paused. Select Play comparison to retry.");
    });
  }

  tick() {
    if (!this.playing) return;
    const reference = this.videos[0];
    if (!this.canPlay || !this.ready) {
      this.refresh();
      return;
    }
    // All clips use their complete duration; progress, not physical time, aligns
    // the comparison when source videos have different frame rates.
    const position = reference.currentTime / reference.duration * this.duration;
    if (this.videos.some((video) => video.ended) || position >= this.duration) {
      this.seek(0);
      return;
    }
    this.position = position;
    this.videos.slice(1).forEach((video) => {
      const clipTime = position / this.duration * video.duration;
      if (Math.abs(video.currentTime - clipTime) > 0.1) video.currentTime = clipTime;
    });
    this.renderTime();
    this.frame = this.requestFrame(() => this.tick());
  }

  renderTime() {
    const duration = this.duration;
    if (this.slider) {
      this.slider.disabled = !duration || !!this.errorMessage;
      this.slider.value = duration ? String(Math.min(100, this.position / duration * 100)) : "0";
      this.slider.setAttribute("aria-valuetext", `${this.position.toFixed(1)} of ${duration.toFixed(1)} seconds`);
    }
    if (this.time) this.time.textContent = `${this.position.toFixed(1)}s / ${duration.toFixed(1)}s`;
    if (this.restartButton) this.restartButton.disabled = !duration || !!this.errorMessage;
  }

  render() {
    this.root.dataset.playbackState = this.errorMessage ? "error" : this.playing ? "playing" : this.starting ? "starting" : "paused";
    if (this.toggle) {
      this.toggle.textContent = this.wanted ? "Pause comparison" : "Play comparison";
      this.toggle.setAttribute("aria-label", this.toggle.textContent);
    }
    let message = this.errorMessage;
    if (!message) {
      if (this.playing) message = "Playing · aligned by clip progress";
      else if (!this.wanted) message = this.reducedMotion ? "Paused · reduced motion" : "Paused";
      else if (!this.documentVisible || !this.visible) message = "Paused while out of view";
      else if (!this.ready) message = "Loading and aligning clips…";
      else message = "Starting comparison…";
    }
    if (this.status && this.status.textContent !== message) this.status.textContent = message;
    this.renderTime();
  }
}

export function setupVideoGroups() {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const groups = new Map();
  const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => groups.get(entry.target)?.setVisible(entry.isIntersecting));
  }, { threshold: 0.01 }) : null;
  document.querySelectorAll("[data-video-group]").forEach((root) => {
    if (!root.querySelector("video")) return;
    const group = new VideoGroup(root, {
      reducedMotion: mediaQuery.matches,
      documentVisible: !document.hidden,
      visible: !observer,
    });
    groups.set(root, group);
    observer?.observe(root);
  });
  document.addEventListener("visibilitychange", () => {
    groups.forEach((group) => group.setDocumentVisible(!document.hidden));
  });
  mediaQuery.addEventListener("change", (event) => {
    groups.forEach((group) => group.setReducedMotion(event.matches));
  });
  return groups;
}
