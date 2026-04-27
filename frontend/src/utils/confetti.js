const COLORS = ['#00ff88', '#a855f7', '#00c2ff', '#ffd700', '#ff6b6b', '#00ff88']

export function triggerConfetti(count = 100) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'confetti-piece'
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    const size  = Math.random() * 10 + 5
    const left  = Math.random() * 100
    const fallDur = (Math.random() * 2 + 2).toFixed(2)
    const swayDur = (Math.random() * 1 + 1).toFixed(2)
    const delay = (Math.random() * 0.8).toFixed(2)
    const shape = Math.random() > 0.5 ? '50%' : '2px'

    el.style.cssText = `
      left: ${left}vw;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${shape};
      box-shadow: 0 0 6px ${color};
      --fall-dur: ${fallDur}s;
      --sway-dur: ${swayDur}s;
      --fall-delay: ${delay}s;
    `
    document.body.appendChild(el)
    setTimeout(() => el.remove(), (parseFloat(fallDur) + parseFloat(delay) + 0.5) * 1000)
  }
}
