# Helpers shared by the scripts that write seed packs (sourced, not run).

# The CC BY-SA 4.0 legal code, as every CC BY-SA pack's LICENSE.
cc_by_sa_4_url="https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt"

fetch() { # url outfile
  echo "downloading $1"
  curl -fsSL --retry 3 -o "$2" "$1"
}

manifest() { # dir id name type language license attribution format
  mkdir -p "$1"
  cat >"$1/manifest.json" <<EOF
{
  "id": "$2",
  "name": "$3",
  "version": "$(date -u +%Y-%m-%d)",
  "type": "$4",
  "language": "$5",
  "license": "$6",
  "attribution": "$7",
  "format": "$8"
}
EOF
}
