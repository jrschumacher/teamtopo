/**
 * Wires a set of header popovers (Examples/History/Share/…) so only one is open at a
 * time, a fixed transparent backdrop closes them on click, and Escape closes them.
 * Shared by the editor and viewer header shells.
 */

export interface PopoverEntry {
	button: HTMLButtonElement;
	panel: HTMLElement;
}

export interface PopoverController {
	/** Close every popover (used after selecting an item, or on outside click / Escape). */
	closeAll(): void;
	/** Remove all listeners this controller attached. */
	dispose(): void;
}

export function setupPopovers(backdrop: HTMLElement, entries: PopoverEntry[]): PopoverController {
	function closeAll() {
		for (const { button, panel } of entries) {
			panel.hidden = true;
			button.setAttribute('aria-expanded', 'false');
		}
		backdrop.hidden = true;
	}

	function open(target: PopoverEntry) {
		for (const { button, panel } of entries) {
			const isTarget = panel === target.panel;
			panel.hidden = !isTarget;
			button.setAttribute('aria-expanded', String(isTarget));
		}
		backdrop.hidden = false;
	}

	const cleanups: (() => void)[] = [];
	for (const entry of entries) {
		const onClick = () => {
			if (entry.panel.hidden) open(entry);
			else closeAll();
		};
		entry.button.addEventListener('click', onClick);
		cleanups.push(() => entry.button.removeEventListener('click', onClick));
	}

	const onBackdrop = () => closeAll();
	backdrop.addEventListener('click', onBackdrop);
	cleanups.push(() => backdrop.removeEventListener('click', onBackdrop));

	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') closeAll();
	};
	document.addEventListener('keydown', onKey);
	cleanups.push(() => document.removeEventListener('keydown', onKey));

	closeAll();
	return {
		closeAll,
		dispose: () => {
			for (const fn of cleanups.splice(0)) fn();
		}
	};
}
