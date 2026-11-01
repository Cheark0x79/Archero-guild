# Attendance and declared absence

Member management ranks undeclared inactive members first, then consecutive misses,
recurrent misses, and isolated misses. Each member shows a consecutive missed-day
count and the number of missed days in the configured calendar window. A missed
day means a captured boss participation or contribution threshold was not met;
several failures on one date count as one missed day. Missing capture dates are
unknown and break a streak, as do successful, grace-period and excused days.

Configure the window (default 14 days), repeated-miss threshold (default 3), and
consecutive-miss threshold (default 3) under guild monitoring rules. Windows and
thresholds use whole days, up to 365. Repetition thresholds start at 2. Counts are
anchored to the dashboard's capture date, so old data does not imply a fresh
observation. Automatic warning history retains the per-date penalty details.

Administrators record an inclusive From/Until period and optional private context
in the member follow-up dialog. All automatic warnings are suppressed on those
dates only. Future leave does not excuse earlier failures. End-only legacy records
have an unknown start and conservatively cover their end date only; add an explicit
start date to approve a longer period.

Replacing or removing leave keeps its elapsed approved dates (through the current
UTC date, at most) in historical attendance. It removes its future coverage. The
private attendance audit records timestamps, before/after absence details, warning
and note changes. It is appended by the server and cannot be overwritten by the
save payload. The actor is the administrator role: the existing shared-token login
does not identify individual officers. Only administrators can read or update this
private audit; public roster data includes dates without private context.

Evaluations use the selected historical day, or the member's metrics capture date
when no view-specific date is supplied. Wall-clock leave cannot excuse an earlier
capture. Historical member filters, summary indicators and PNG exports use that
same selected-day context; approved absences are excluded from incomplete-task
counts.

All member-admin saves and ID moves serialize through an exclusive filesystem
lock on the shared records file, including separate Node worker processes. Updates
use atomic replacement; concurrent acknowledged changes retain their audit entries
and approved past periods. A busy lock returns HTTP 409 after five seconds. Locks
are never stolen automatically: after a crashed writer, an operator must stop all
writers and confirm the lock is orphaned before removing `data/member-admin.json.lock`
and restarting the service.
