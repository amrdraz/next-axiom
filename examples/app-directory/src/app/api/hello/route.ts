import { AxiomRouteHandlerContext, withAxiom } from 'next-axiom';

export const runtime = 'nodejs';

export const GET = withAxiom(async (req: AxiomRouteHandlerContext) => {
  req.log.info('this is axiom', {runtime: 'nodejs'});

  return new Response('Hello, Next.js!');
});
