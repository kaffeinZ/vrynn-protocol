import { Card, CardContent } from '@/components/ui/card'

export default function RiskScore({ score }) {
  const color =
    score <= 20 ? '#2ecc00' :
    score <= 50 ? '#00c8e0' :
    score <= 75 ? '#e06000' :
    '#e0007a'

  const label =
    score <= 20 ? 'Low Risk' :
    score <= 50 ? 'Moderate' :
    score <= 75 ? 'High Risk' :
    'Critical'

  const radius = 54
  const circumference = Math.PI * radius
  const progress = circumference - (score / 100) * circumference

  return (
    <Card style={{ boxShadow: `0 4px 24px ${color}25` }}>
      <CardContent className="flex flex-col items-center gap-2 pt-4">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">Portfolio Risk Score</p>

        <div className="relative w-36 h-20 overflow-hidden">
          <svg viewBox="0 0 120 64" className="w-full h-full">
            <path
              d="M 8 60 A 54 54 0 0 1 112 60"
              fill="none"
              stroke="currentColor"
              className="text-muted"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 8 60 A 54 54 0 0 1 112 60"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={progress}
              style={{
                transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease',
                filter: `drop-shadow(0 0 4px ${color})`,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-3xl font-black leading-none">{score}</span>
          </div>
        </div>

        <p className="text-sm font-bold uppercase tracking-wider" style={{ color }}>{label}</p>
        <p className="text-muted-foreground text-xs">0 = no risk · 100 = liquidation imminent</p>
      </CardContent>
    </Card>
  )
}
