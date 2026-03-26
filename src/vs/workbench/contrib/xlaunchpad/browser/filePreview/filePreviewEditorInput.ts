/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { basename } from '../../../../../base/common/resources.js';

export class FilePreviewEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.filePreview';

	constructor(
		private readonly _resource: URI,
	) {
		super();
	}

	get typeId(): string {
		return FilePreviewEditorInput.ID;
	}

	override get editorId(): string {
		return FilePreviewEditorInput.ID;
	}

	get resource(): URI {
		return this._resource;
	}

	override getName(): string {
		return basename(this._resource);
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof FilePreviewEditorInput) {
			return other._resource.toString() === this._resource.toString();
		}
		return false;
	}
}
