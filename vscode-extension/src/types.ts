export interface QueryParam {
  key: string;
  value?: string;
  disabled?: boolean;
}

export interface Endpoint {
  id: string;
  name: string;
  method: string;
  path: string[];
  group: string;
  query: QueryParam[];
  /** Имена path-параметров из шаблона URL, например version для {version} */
  pathParams: string[];
  collectionId: string;
  collectionName: string;
  sourceFile: string;
}

export interface CollectionInfo {
  id: string;
  name: string;
  sourceFile: string;
  endpoints: Endpoint[];
}
