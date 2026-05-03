import { Button } from '@/components/ui/button'

export default function ThemeToggle({ dark, toggle }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="text-muted-foreground hover:text-foreground"
    >
      {dark ? '☀' : '☾'}
    </Button>
  )
}
