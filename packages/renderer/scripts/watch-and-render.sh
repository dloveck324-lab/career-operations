#!/bin/bash
# watch-and-render.sh — pairs with Claude Cowork sessions.
#
# Run this in a Terminal tab and leave it open while you work with Claude.
# When Claude edits a template and writes the trigger file, this script picks
# it up and runs generate-pdf.mjs locally on your Mac, which produces a
# clean PDF (no Linux Chromium quantization bug) and auto-opens the PDF.
#
# Trigger file format: a single line with the template filename, e.g.
#   resume.html
#   resume-tailored-savas.html
# If the file is empty, defaults to resume.html.

set -uo pipefail

# Ensure node is findable when this script runs from launchd (which doesn't
# inherit interactive shell PATH). Cover Homebrew (ARM + Intel), system,
# and try sourcing user shell profiles for nvm/asdf setups.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null

# Resolve RENDERER_DIR from the script's own location so this works from
# any clone of the repo, not a hardcoded path.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RENDERER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
TRIGGER="$RENDERER_DIR/.render-trigger"
DEFAULT_TEMPLATE="resume.html"
OUTPUT_DIR="$RENDERER_DIR/output"

# Colors
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ ! -d "$RENDERER_DIR/templates" ]; then
  echo -e "${RED}Renderer templates folder not found: $RENDERER_DIR/templates${NC}"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}Resume watcher active.${NC}"
echo "  Renderer:  $RENDERER_DIR"
echo "  Trigger:   $TRIGGER"
echo "  Output:    $OUTPUT_DIR"
echo "  Default:   $DEFAULT_TEMPLATE"
echo ""
echo -e "${YELLOW}Leave this tab open. Ctrl-C to stop.${NC}"
echo ""

LAST_MTIME=""

while true; do
  if [ -f "$TRIGGER" ]; then
    MTIME=$(stat -f "%m" "$TRIGGER" 2>/dev/null || echo "")
    if [ -n "$MTIME" ] && [ "$MTIME" != "$LAST_MTIME" ]; then
      LAST_MTIME="$MTIME"

      TEMPLATE_NAME=$(grep -v '^[[:space:]]*$' "$TRIGGER" 2>/dev/null | head -1 | tr -d '\r\n' || echo "")
      [ -z "$TEMPLATE_NAME" ] && TEMPLATE_NAME="$DEFAULT_TEMPLATE"

      TEMPLATE_PATH="$RENDERER_DIR/templates/$TEMPLATE_NAME"
      OUTPUT_NAME="${TEMPLATE_NAME%.html}.pdf"
      OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_NAME"

      if [ ! -f "$TEMPLATE_PATH" ]; then
        echo -e "${RED}[$(date +%H:%M:%S)] Template not found: $TEMPLATE_PATH${NC}"
        echo ""
        continue
      fi

      echo -e "${BLUE}[$(date +%H:%M:%S)] Rendering${NC} $TEMPLATE_NAME -> $OUTPUT_NAME"
      if node "$RENDERER_DIR/generate-pdf.mjs" "$TEMPLATE_PATH" "$OUTPUT_PATH"; then
        echo -e "${GREEN}[$(date +%H:%M:%S)] Done.${NC}"
      else
        echo -e "${RED}[$(date +%H:%M:%S)] Render failed (see error above).${NC}"
      fi
      echo ""
    fi
  fi
  sleep 0.5
done
