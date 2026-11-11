import { Switch } from '../ui/Switch'

interface MyPaySwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  busy?: boolean
}

// The Team list's inline My Pay toggle: the shared Switch with the row's name as its label.
export default function MyPaySwitch(props: MyPaySwitchProps) {
  return <Switch {...props} hideLabel />
}
