import type { AdminUser } from '../../lib/api'

export interface WebsiteDraft {
  public_team_enabled: boolean
  public_team_name: string
  public_team_title: string
  public_team_bio: string
  public_team_sort_order: number
  public_team_photo_position_x: number
  public_team_photo_position_y: number
}

export function websiteDraft(user: AdminUser): WebsiteDraft {
  return {
    public_team_enabled: user.public_team_enabled,
    public_team_name: user.public_team_name || '', public_team_title: user.public_team_title || '', public_team_bio: user.public_team_bio || '',
    public_team_sort_order: user.public_team_sort_order,
    public_team_photo_position_x: user.public_team_photo_position_x, public_team_photo_position_y: user.public_team_photo_position_y,
  }
}

