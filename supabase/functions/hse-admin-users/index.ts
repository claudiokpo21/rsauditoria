// Punto de entrada de la Edge Function (la lógica y sus controles están en handler.ts).
import { handle } from './handler.ts';

Deno.serve(req => handle(req, k => Deno.env.get(k)));
