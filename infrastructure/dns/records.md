# DNS records for example.com
#
# NOTE: These are templates. Apply them at your DNS provider. This project does
# NOT modify DNS for you. Replace 203.0.113.10 with your server's public IP and
# <DKIM_P> with the base64 public key from infrastructure/dkim/catchbox.public.key.

# --- Core ---
# Type  Name   Value
A       @      203.0.113.10
AAAA    @      <your IPv6 if available>
A       mail   203.0.113.10

# --- Inbound mail routing ---
MX      @      10 mail.example.com.

# --- Sender policy (outbound) ---
TXT     @      "v=spf1 mx ip4:203.0.113.10 -all"

# --- DKIM (selector: quit) ---
TXT     catchbox._domainkey   "v=DKIM1; k=rsa; p=<DKIM_P>"

# --- DMARC ---
TXT     _dmarc "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@example.com; fo=1"

# --- Reverse DNS (PTR) ---
# Configure at your hosting provider (not in zone file):
#   203.0.113.10 -> mail.example.com

# --- MTA-STS (optional but recommended) ---
TXT     _mta-sts   "v=STSv1; id=2026080701"
# Host a policy at https://mta-sts.example.com/.well-known/mta-sts.txt:
#   version: STSv1
#   mode: enforce
#   mx: mail.example.com
#   max_age: 86400

# --- TLS reporting (optional) ---
TXT     _smtp._tls "v=TLSRPTv1; rua=mailto:tls-reports@example.com"
