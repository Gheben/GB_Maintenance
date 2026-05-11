// Status & Criticality badge helpers
const STATUS_STYLES = {
  operational:      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  degraded:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  partial_outage:   'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  major_outage:     'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  under_maintenance:'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  unknown:          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  // maintenance statuses
  scheduled:        'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  in_progress:      'bg-orange-100 text-orange-800',
  completed:        'bg-green-100 text-green-800',
  cancelled:        'bg-gray-100 text-gray-600',
  rejected:         'bg-red-100 text-red-800',
  // incident statuses
  investigating:    'bg-red-100 text-red-800',
  identified:       'bg-orange-100 text-orange-800',
  monitoring:       'bg-yellow-100 text-yellow-800',
  resolved:         'bg-green-100 text-green-800',
}

const STATUS_LABELS = {
  operational: 'Operativo', degraded: 'Degradato', partial_outage: 'Parziale',
  major_outage: 'Fuori servizio', under_maintenance: 'In manutenzione', unknown: 'Sconosciuto',
  scheduled: 'Pianificato', pending_approval: 'In approvazione', in_progress: 'In corso',
  completed: 'Completato', cancelled: 'Annullato', rejected: 'Rifiutato',
  investigating: 'In analisi', identified: 'Identificato', monitoring: 'Monitoraggio', resolved: 'Risolto',
}

export function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.unknown
  return <span className={`badge ${cls}`}>{STATUS_LABELS[status] || status}</span>
}

const CRIT_STYLES = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  low:      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
}

const CRIT_LABELS = { critical: 'Critico', high: 'Alto', medium: 'Medio', low: 'Basso' }

export function CriticalityBadge({ criticality }) {
  const cls = CRIT_STYLES[criticality] || 'bg-gray-100 text-gray-600'
  return <span className={`badge ${cls}`}>{CRIT_LABELS[criticality] || criticality}</span>
}
