# frozen_string_literal: true

class FreezePayrollCalendarOvertimePolicy < ActiveRecord::Migration[8.1]
  def change
    add_column :payroll_calendar_periods, :overtime_policy, :jsonb, null: false, default: {}
    add_check_constraint :payroll_calendar_periods,
                         "jsonb_typeof(overtime_policy) = 'object'",
                         name: "payroll_calendar_overtime_policy_object"
  end
end
