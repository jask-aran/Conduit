declare module "virtual:gallery-api" {
  export interface ApiProp {
    name: string;
    type: string;
    optional: boolean;
    doc: string;
  }

  export interface ApiComponent {
    name: string;
    file: string;
    line: number;
    doc: string;
    props: ApiProp[];
    extends?: string;
    usedIn: string[];
  }

  const api: { generated: string; components: Record<string, ApiComponent> };
  export default api;
}
