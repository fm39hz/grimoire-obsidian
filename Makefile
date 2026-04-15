-include .env

.PHONY: build

build:
	bun run build
	rm -f $(OBSIDIAN_VAULT_PATH)/.obsidian/plugins/grimoire-obsidian/{manifest.json,main.js,styles.css}
	mkdir -p $(OBSIDIAN_VAULT_PATH)/.obsidian/plugins/grimoire-obsidian/
	cp manifest.json main.js styles.css $(OBSIDIAN_VAULT_PATH)/.obsidian/plugins/grimoire-obsidian/
