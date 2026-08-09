// scout-engine/src/tools/registry.ts
// 25 automated security scanning tools organized by category

export interface ScoutTool {
  name: string;
  category: 'recon' | 'vuln_scan' | 'fuzzing' | 'ids' | 'reporting';
  command: string; // Template: "nmap -sV -sC {target}"
  timeout: number; // Max execution time in seconds
  priority: number; // Execution order (lower = earlier)
  producesFindings: boolean;
  findingMapping?: {                   // How to parse tool output into finding fields
    type?: string;
    severityExtractor?: string; // JS expression or JSON path
    titleExtractor?: string;
  };
  rateLimit: {                         // Politeness controls
    maxConcurrent: number;
    delayBetweenTargets: number; // ms
  };
  outputParser?: 'json' | 'xml' | 'text' | 'lines';
  requiresTargetFormat?: 'domain' | 'ip' | 'url';
}

export const SCOUT_TOOLS: ScoutTool[] = [

  // ════════════════════════════════════════════════
  // RECONNAISSANCE (10 tools)
  // ════════════════════════════════════════════════

  {
    name: 'nmap',
    category: 'recon',
    command: 'nmap -sV -sC -p- --open -oX - {target}',
    timeout: 600,
    priority: 1,
    producesFindings: true,
    outputParser: 'xml',
    findingMapping: {
      type: 'open_port',
      severityExtractor: 'port.service && port.service.tunnel === "ssl" ? "medium" : "low"',
      titleExtractor: 'port.service.product || port.service.name',
    },
    rateLimit: { maxConcurrent: 2, delayBetweenTargets: 5000 },
    requiresTargetFormat: 'ip',
  },
  {
    name: 'amass',
    category: 'recon',
    command: 'amass enum -passive -d {target} -json -',
    timeout: 300,
    priority: 1,
    producesFindings: true,
    outputParser: 'json',
    findingMapping: {
      type: 'subdomain',
      severityExtractor: '"info"',
      titleExtractor: 'name',
    },
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 10000 },
    requiresTargetFormat: 'domain',
  },
  {
    name: 'theHarvester',
    category: 'recon',
    command: 'theHarvester -d {target} -b all -f /tmp/harvester_{target}',
    timeout: 180,
    priority: 2,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 15000 },
    requiresTargetFormat: 'domain',
  },
  {
    name: 'shodan',
    category: 'recon',
    command: 'shodan domain {target}',
    timeout: 30,
    priority: 2,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 2000 },
    requiresTargetFormat: 'domain',
  },
  {
    name: 'censys',
    category: 'recon',
    command: 'censys search "services.tls.certificates.leaf_data.subject.common_name:{target}"',
    timeout: 30,
    priority: 3,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 3000 },
    requiresTargetFormat: 'domain',
  },
  {
    name: 'masscan',
    category: 'recon',
    command: 'masscan {target} -p1-65535 --rate=1000 -oJ -',
    timeout: 300,
    priority: 2,
    producesFindings: true,
    outputParser: 'json',
    findingMapping: {
      type: 'open_port',
      severityExtractor: '"low"',
      titleExtractor: 'ports[0].port + "/" + (ports[0].proto || "tcp")',
    },
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 30000 },
    requiresTargetFormat: 'ip',
  },
  {
    name: 'whatweb',
    category: 'recon',
    command: 'whatweb {target} --log-json=-',
    timeout: 120,
    priority: 3,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 2, delayBetweenTargets: 3000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'dnsrecon',
    category: 'recon',
    command: 'dnsrecon -d {target} -j -',
    timeout: 120,
    priority: 2,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 2, delayBetweenTargets: 5000 },
    requiresTargetFormat: 'domain',
  },
  {
    name: 'httpx',
    category: 'recon',
    command: 'httpx -u {target} -json',
    timeout: 60,
    priority: 3,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 3, delayBetweenTargets: 2000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'subfinder',
    category: 'recon',
    command: 'subfinder -d {target} -json',
    timeout: 180,
    priority: 2,
    producesFindings: true,
    outputParser: 'json',
    findingMapping: {
      type: 'subdomain',
      severityExtractor: '"info"',
      titleExtractor: 'host',
    },
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 10000 },
    requiresTargetFormat: 'domain',
  },

  // ════════════════════════════════════════════════
  // VULNERABILITY SCANNING (5 tools)
  // ════════════════════════════════════════════════

  {
    name: 'nuclei',
    category: 'vuln_scan',
    command: 'nuclei -u {target} -severity critical,high,medium -json -',
    timeout: 600,
    priority: 5,
    producesFindings: true,
    outputParser: 'json',
    findingMapping: {
      type: 'vulnerability',
      severityExtractor: 'info.severity',
      titleExtractor: 'info.name',
    },
    rateLimit: { maxConcurrent: 2, delayBetweenTargets: 5000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'openvas',
    category: 'vuln_scan',
    command: 'gvm-cli scan --target {target} --format json',
    timeout: 1800,
    priority: 6,
    producesFindings: true,
    outputParser: 'json',
    findingMapping: {
      type: 'vulnerability',
      severityExtractor: 'severity',
      titleExtractor: 'name',
    },
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 60000 },
    requiresTargetFormat: 'ip',
  },
  {
    name: 'nikto',
    category: 'vuln_scan',
    command: 'nikto -h {target} -Format json',
    timeout: 600,
    priority: 4,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 2, delayBetweenTargets: 10000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'wapiti',
    category: 'vuln_scan',
    command: 'wapiti -u {target} --format json',
    timeout: 900,
    priority: 6,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 30000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'sslscan',
    category: 'vuln_scan',
    command: 'sslscan --no-colour {target}',
    timeout: 120,
    priority: 3,
    producesFindings: true,
    outputParser: 'text',
    findingMapping: {
      type: 'certificate_issue',
      severityExtractor: 'status === "accepted" ? "low" : "medium"',
    },
    rateLimit: { maxConcurrent: 3, delayBetweenTargets: 3000 },
    requiresTargetFormat: 'domain',
  },

  // ════════════════════════════════════════════════
  // FUZZING (4 tools)
  // ════════════════════════════════════════════════

  {
    name: 'ffuf',
    category: 'fuzzing',
    command: 'ffuf -u {target}/FUZZ -w /usr/share/wordlists/dirb/common.txt -json',
    timeout: 300,
    priority: 7,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 20000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'wfuzz',
    category: 'fuzzing',
    command: 'wfuzz -c -z file,/usr/share/wordlists/wfuzz/general/common.txt --hc 404 {target}/FUZZ',
    timeout: 300,
    priority: 8,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 20000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'dirb',
    category: 'fuzzing',
    command: 'dirb {target} /usr/share/wordlists/dirb/common.txt',
    timeout: 300,
    priority: 7,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 20000 },
    requiresTargetFormat: 'url',
  },
  {
    name: 'gobuster',
    category: 'fuzzing',
    command: 'gobuster dir -u {target} -w /usr/share/wordlists/dirb/common.txt --json',
    timeout: 300,
    priority: 7,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 20000 },
    requiresTargetFormat: 'url',
  },

  // ════════════════════════════════════════════════
  // INTRUSION DETECTION (5 tools; monitoring, not active scanning)
  // ════════════════════════════════════════════════

  {
    name: 'snort',
    category: 'ids',
    command: 'snort -A console -q -c /etc/snort/snort.conf -i eth0',
    timeout: 0,                              // Continuous; runs as daemon
    priority: 99,
    producesFindings: true,
    outputParser: 'text',
    findingMapping: {
      type: 'intrusion_alert',
      severityExtractor: 'priority === 1 ? "critical" : priority === 2 ? "high" : "medium"',
      titleExtractor: 'msg',
    },
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 0 },
  },
  {
    name: 'suricata',
    category: 'ids',
    command: 'suricata -c /etc/suricata/suricata.yaml -i eth0',
    timeout: 0,                              // Continuous
    priority: 99,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 0 },
  },
  {
    name: 'zeek',
    category: 'ids',
    command: 'zeek -i eth0 local',
    timeout: 0,                              // Continuous
    priority: 99,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 0 },
  },
  {
    name: 'wireshark',
    category: 'ids',
    command: 'tshark -i eth0 -a duration:300',
    timeout: 300,
    priority: 10,
    producesFindings: true,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 60000 },
  },
  {
    name: 'tcpdump',
    category: 'ids',
    command: 'tcpdump -i eth0 -c 10000 -w /tmp/scout_{target}.pcap',
    timeout: 300,
    priority: 10,
    producesFindings: false,
    outputParser: 'text',
    rateLimit: { maxConcurrent: 1, delayBetweenTargets: 60000 },
  },

  // ════════════════════════════════════════════════
  // ADDITIONAL RECON/VULN (1 tool)
  // ════════════════════════════════════════════════

  {
    name: 'testssl',
    category: 'vuln_scan',
    command: 'testssl --json {target}',
    timeout: 300,
    priority: 3,
    producesFindings: true,
    outputParser: 'json',
    rateLimit: { maxConcurrent: 3, delayBetweenTargets: 5000 },
    requiresTargetFormat: 'domain',
  },
];

export function getToolsByCategory(category: string): ScoutTool[] {
  return SCOUT_TOOLS.filter(t => t.category === category);
}

export function getActiveScanTools(): ScoutTool[] {
  return SCOUT_TOOLS
    .filter(t => t.priority < 99 && t.timeout > 0)
    .sort((a, b) => a.priority - b.priority);
}

export function getFastScanTools(): ScoutTool[] {
  // Subset of fastest tools for onboarding first scan (<2 minutes)
  return SCOUT_TOOLS
    .filter(t => ['nmap', 'whatweb', 'httpx', 'sslscan', 'dnsrecon', 'shodan', 'subfinder', 'amass', 'testssl', 'nuclei'].includes(t.name))
    .sort((a, b) => a.priority - b.priority);
}

export function getTool(name: string): ScoutTool | undefined {
  return SCOUT_TOOLS.find(t => t.name === name);
}
